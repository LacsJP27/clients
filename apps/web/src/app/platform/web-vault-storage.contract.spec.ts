import { WindowStorageService } from "@bitwarden/common/platform/storage/window-storage.service";
import { runVaultStorageContract } from "@bitwarden/storage-test-utils";

import { WebVaultStorage } from "./web-vault-storage";

type StorageOperation = "getItem" | "setItem" | "removeItem";

/** A double of the browser's `Storage` that can fail the way the real one does: by throwing. */
class FakeWebStorage implements Storage {
  readonly items = new Map<string, string>();
  private readonly armed = new Map<StorageOperation, unknown>();

  failNext(operation: StorageOperation, error: unknown): void {
    this.armed.set(operation, error);
  }

  get length(): number {
    return this.items.size;
  }

  getItem(key: string): string | null {
    this.throwIfArmed("getItem");
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.throwIfArmed("setItem");
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.throwIfArmed("removeItem");
    this.items.delete(key);
  }

  clear(): void {
    this.items.clear();
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  private throwIfArmed(operation: StorageOperation): void {
    if (this.armed.has(operation)) {
      const error = this.armed.get(operation);
      this.armed.delete(operation);
      throw error;
    }
  }
}

let webStorage: FakeWebStorage;

function create(): WebVaultStorage {
  webStorage = new FakeWebStorage();
  return new WebVaultStorage(new WindowStorageService(webStorage));
}

const quotaError = () => new DOMException("The quota has been exceeded.", "QuotaExceededError");
const securityError = () => new DOMException("The operation is insecure.", "SecurityError");

runVaultStorageContract("WebVaultStorage", create, {
  simulateFailure: {
    quotaExceededOnSave: () => webStorage.failNext("setItem", quotaError()),
    unavailableOnSave: () => webStorage.failNext("setItem", securityError()),
    unavailableOnRemove: () => webStorage.failNext("removeItem", securityError()),
    unavailableOnGet: () => webStorage.failNext("getItem", securityError()),
    unavailableOnHas: () => webStorage.failNext("getItem", securityError()),
    corruptDataOnGet: (_storage, key) => void webStorage.items.set(key, "{not json"),
  },
});

describe("WebVaultStorage and existing data", () => {
  it("reads and writes the JSON text the web vault already stores", async () => {
    const storage = create();
    webStorage.items.set("existing", JSON.stringify({ a: 1 }));

    await expect(storage.get("existing")).resolves.toEqual({ a: 1 });
    await storage.save("key", { b: 2 });

    expect(webStorage.items.get("key")).toBe(JSON.stringify({ b: 2 }));
  });
});
