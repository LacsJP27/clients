import { firstValueFrom } from "rxjs";

import { runSecureStorageContract } from "@bitwarden/storage-test-utils";

import {
  DesktopSecureStorage,
  DesktopSecureStorageCapability,
} from "./desktop-secure-storage.capability";
import { ElectronRendererSecureStorageService } from "./electron-renderer-secure-storage.service";

type BridgeOperation = "get" | "set" | "delete";
let credentials: Map<string, string>;
let armed: Map<BridgeOperation, Error>;

/** A double of the preload bridge to the operating system's credential store. */
function installBridge(): void {
  credentials = new Map();
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
      passwords: {
        get: (key: string) => invoke("get", () => credentials.get(key) ?? null),
        has: (key: string) => invoke("get", () => credentials.has(key)),
        set: (key: string, _suffix: string, value: string) =>
          invoke("set", () => void credentials.set(key, value)),
        delete: (key: string) => invoke("delete", () => void credentials.delete(key)),
      },
    },
  };
}

function create(): DesktopSecureStorage {
  installBridge();
  return new DesktopSecureStorage(new ElectronRendererSecureStorageService());
}

const locked = () => new Error("Error invoking remote method 'keytar': Error: store is locked");

afterEach(() => {
  delete (globalThis as { ipc?: unknown }).ipc;
});

runSecureStorageContract("DesktopSecureStorage", create, {
  simulateFailure: {
    unavailableOnSave: () => void armed.set("set", locked()),
    unavailableOnRemove: () => void armed.set("delete", locked()),
    unavailableOnGet: () => void armed.set("get", locked()),
    unavailableOnHas: () => void armed.set("get", locked()),
    corruptDataOnGet: (_storage, key) => void credentials.set(key, "{not json"),
  },
});

describe("DesktopSecureStorage and existing entries", () => {
  it("reads and writes the format the credential store already holds", async () => {
    const storage = create();
    credentials.set("existing", JSON.stringify("stored-before"));

    await expect(storage.get("existing")).resolves.toBe("stored-before");
    await storage.save("key", "value");

    expect(credentials.get("key")).toBe(JSON.stringify("value"));
  });
});

describe("DesktopSecureStorageCapability", () => {
  it("offers secure storage when the installation uses the credential store", async () => {
    installBridge();
    const capability = new DesktopSecureStorageCapability(
      new ElectronRendererSecureStorageService(),
      true,
    );

    const status = await firstValueFrom(capability.status$);

    expect(status.type).toBe("supported");
  });

  it("reports not-supported, and never touches the credential store, when it does not", async () => {
    const capability = new DesktopSecureStorageCapability(
      new ElectronRendererSecureStorageService(),
      false,
    );

    await expect(firstValueFrom(capability.status$)).resolves.toEqual({
      type: "not-supported",
      reason: "disabled-for-installation",
    });
  });
});
