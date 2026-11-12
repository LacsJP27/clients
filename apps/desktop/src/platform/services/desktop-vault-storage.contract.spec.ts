import { runVaultStorageContract } from "@bitwarden/storage-test-utils";

import { ElectronStorageService } from "../main/electron-storage.service";
import { StorageBackend } from "../main/storage/storage-backend";

import { DesktopVaultStorage } from "./desktop-vault-storage";
import { ElectronRendererStorageService } from "./electron-renderer-storage.service";

jest.mock("electron", () => ({ ipcMain: { handle: jest.fn() } }));

const outOfSpace = () => Object.assign(new Error("write failed"), { code: "ENOSPC" });

/** A double of the main process's whole-store backend. */
class FakeStoreBackend implements StorageBackend {
  store: Record<string, unknown> = {};
  private readonly armed = new Map<"read" | "update", unknown>();

  failNext(operation: "read" | "update", error: unknown): void {
    this.armed.set(operation, error);
  }

  read(): Record<string, unknown> {
    this.throwIfArmed("read");
    return this.store;
  }

  update(updater: (store: Record<string, unknown>) => Record<string, unknown>): void {
    this.throwIfArmed("update");
    this.store = updater({ ...this.store });
  }

  flush(): void {}

  private throwIfArmed(operation: "read" | "update"): void {
    if (this.armed.has(operation)) {
      const error = this.armed.get(operation);
      this.armed.delete(operation);
      throw error;
    }
  }
}

describe("main process", () => {
  let backend: FakeStoreBackend;

  function create(): DesktopVaultStorage {
    backend = new FakeStoreBackend();
    return new DesktopVaultStorage(new ElectronStorageService(backend));
  }

  // The store holds parsed values, so a value that cannot be decoded has no equivalent here.
  runVaultStorageContract("DesktopVaultStorage (main)", create, {
    simulateFailure: {
      quotaExceededOnSave: () => backend.failNext("update", outOfSpace()),
      unavailableOnSave: () => backend.failNext("update", new Error("store unavailable")),
      unavailableOnRemove: () => backend.failNext("update", new Error("store unavailable")),
      unavailableOnGet: () => backend.failNext("read", new Error("store unavailable")),
      unavailableOnHas: () => backend.failNext("read", new Error("store unavailable")),
    },
  });

  it("keeps the store's existing format: values are stored as they are", async () => {
    const storage = create();
    backend.store.existing = { a: 1 };

    await expect(storage.get("existing")).resolves.toEqual({ a: 1 });
    await storage.save("key", { b: 2 });

    expect(backend.store.key).toEqual({ b: 2 });
  });
});

describe("renderer process", () => {
  type BridgeOperation = "get" | "save" | "remove";
  let stored: Map<string, string>;
  let armed: Map<BridgeOperation, Error>;

  /** A double of the preload bridge: values are copied crossing it, failures arrive as messages. */
  function installBridge(): void {
    stored = new Map();
    armed = new Map();
    const invoke = async <T>(operation: BridgeOperation, action: () => T): Promise<T> => {
      const failure = armed.get(operation);
      if (failure !== undefined) {
        armed.delete(operation);
        throw failure;
      }
      return action();
    };
    (globalThis as { ipc?: unknown }).ipc = {
      platform: {
        storage: {
          get: (key: string) =>
            invoke("get", () => (stored.has(key) ? JSON.parse(stored.get(key)!) : null)),
          has: (key: string) => invoke("get", () => stored.has(key)),
          save: (key: string, value: unknown) =>
            invoke("save", () => void stored.set(key, JSON.stringify(value))),
          remove: (key: string) => invoke("remove", () => void stored.delete(key)),
        },
      },
    };
  }

  function create(): DesktopVaultStorage {
    installBridge();
    return new DesktopVaultStorage(new ElectronRendererStorageService());
  }

  const remoteError = (detail: string) =>
    new Error(`Error invoking remote method 'storageService': Error: ${detail}`);

  runVaultStorageContract("DesktopVaultStorage (renderer)", create, {
    cleanup: () => {
      delete (globalThis as { ipc?: unknown }).ipc;
    },
    simulateFailure: {
      quotaExceededOnSave: () => void armed.set("save", remoteError("ENOSPC: no space left")),
      unavailableOnSave: () => void armed.set("save", remoteError("store unavailable")),
      unavailableOnRemove: () => void armed.set("remove", remoteError("store unavailable")),
      unavailableOnGet: () => void armed.set("get", remoteError("store unavailable")),
      unavailableOnHas: () => void armed.set("get", remoteError("store unavailable")),
    },
  });
});
