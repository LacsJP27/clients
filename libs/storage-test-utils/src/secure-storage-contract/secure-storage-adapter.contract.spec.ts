import {
  SecureStorageAdapter,
  SecureStorageBackend,
  SecureStorageErrorCode,
} from "@bitwarden/storage-core";

import { runSecureStorageContract } from "./run-secure-storage-contract";

type Operation = keyof SecureStorageBackend;

/** A backend that answers synchronously, reports absent keys as `undefined`, and fails plainly. */
class PlainBackend implements SecureStorageBackend {
  readonly store = new Map<string, unknown>();
  private readonly armed = new Map<Operation, unknown>();

  failNext(operation: Operation, error: unknown): void {
    this.armed.set(operation, error);
  }

  get(key: string): unknown {
    this.throwIfArmed("get");
    return this.store.get(key);
  }

  save(key: string, value: string): void {
    this.throwIfArmed("save");
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.throwIfArmed("remove");
    this.store.delete(key);
  }

  private throwIfArmed(operation: Operation): void {
    if (this.armed.has(operation)) {
      const error = this.armed.get(operation);
      this.armed.delete(operation);
      throw error;
    }
  }
}

const backends = new WeakMap<SecureStorageAdapter, PlainBackend>();
const backendOf = (storage: SecureStorageAdapter) => backends.get(storage)!;

function create(): SecureStorageAdapter {
  const backend = new PlainBackend();
  const storage = new SecureStorageAdapter(backend, {
    mapError: (error) =>
      (error as { denied?: boolean }).denied ? SecureStorageErrorCode.AccessDenied : undefined,
  });
  backends.set(storage, backend);
  return storage;
}

runSecureStorageContract("SecureStorageAdapter", create, {
  simulateFailure: {
    unavailableOnSave: (storage) => backendOf(storage).failNext("save", new Error("locked")),
    unavailableOnRemove: (storage) => backendOf(storage).failNext("remove", new Error("locked")),
    // `has` is derived from the backend's `get`.
    unavailableOnGet: (storage) => backendOf(storage).failNext("get", new Error("locked")),
    unavailableOnHas: (storage) => backendOf(storage).failNext("get", new Error("locked")),
    accessDeniedOnGet: (storage) => backendOf(storage).failNext("get", { denied: true }),
    corruptDataOnGet: (storage, key) => void backendOf(storage).store.set(key, { not: "text" }),
  },
});

describe("SecureStorageAdapter", () => {
  it("keeps the cause of a translated failure", async () => {
    const storage = create();
    const cause = new Error("keychain locked");
    backendOf(storage).failNext("save", cause);

    const error = await storage.save("key", "value").catch((e: unknown) => e);

    expect(error).toMatchObject({ code: SecureStorageErrorCode.Unavailable, cause });
  });
});
