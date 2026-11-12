import {
  VaultStorageAdapter,
  VaultStorageBackend,
  VaultStorageErrorCode,
} from "@bitwarden/storage-core";

import { runVaultStorageContract } from "./run-vault-storage-contract";

type Operation = keyof VaultStorageBackend;

/**
 * A deliberately badly behaved backend: it keeps the caller's object, hands the same reference
 * back, reports absent keys as `undefined`, answers after a varying delay, and fails with plain
 * errors. Passing the suite over it shows the adapter supplies the guarantees by itself.
 */
class LiveReferenceBackend implements VaultStorageBackend {
  readonly store = new Map<string, unknown>();
  private readonly armed: Array<{ operation: Operation; key: string; error: unknown }> = [];
  private hops = 0;

  async get(key: string): Promise<unknown> {
    await this.delay();
    this.throwIfArmed("get", key);
    const value = this.store.get(key);
    if (value === CORRUPT) {
      throw new SyntaxError("Unexpected token");
    }
    return value;
  }

  async save(key: string, value: unknown): Promise<void> {
    await this.delay();
    this.throwIfArmed("save", key);
    this.store.set(key, value);
  }

  remove(key: string): void {
    this.throwIfArmed("remove", key);
    this.store.delete(key);
  }

  failNext(operation: Operation, key: string, error: unknown): void {
    this.armed.push({ operation, key, error });
  }

  private throwIfArmed(operation: Operation, key: string): void {
    const index = this.armed.findIndex((f) => f.operation === operation && f.key === key);
    if (index !== -1) {
      throw this.armed.splice(index, 1)[0].error;
    }
  }

  private async delay(): Promise<void> {
    for (let hop = this.hops++ % 3; hop > 0; hop--) {
      await Promise.resolve();
    }
  }
}

const CORRUPT = Symbol("corrupt");
const backends = new WeakMap<VaultStorageAdapter, LiveReferenceBackend>();
const backendOf = (storage: VaultStorageAdapter) => backends.get(storage)!;

function create(): VaultStorageAdapter {
  const backend = new LiveReferenceBackend();
  const storage = new VaultStorageAdapter(backend, {
    mapError: (error) =>
      (error as { quota?: boolean }).quota ? VaultStorageErrorCode.QuotaExceeded : undefined,
  });
  backends.set(storage, backend);
  return storage;
}

runVaultStorageContract("VaultStorageAdapter", create, {
  simulateFailure: {
    quotaExceededOnSave: (storage, key) =>
      backendOf(storage).failNext("save", key, { quota: true }),
    unavailableOnSave: (storage, key) => backendOf(storage).failNext("save", key, new Error("io")),
    unavailableOnRemove: (storage, key) =>
      backendOf(storage).failNext("remove", key, new Error("io")),
    // `has` is derived from the backend's `get`.
    unavailableOnGet: (storage, key) => backendOf(storage).failNext("get", key, new Error("io")),
    unavailableOnHas: (storage, key) => backendOf(storage).failNext("get", key, new Error("io")),
    corruptDataOnGet: (storage, key) => void backendOf(storage).store.set(key, CORRUPT),
  },
});

describe("VaultStorageAdapter", () => {
  it("keeps the cause of a translated failure and puts no key or value in the message", async () => {
    const storage = create();
    const cause = new Error("disk gone");
    backendOf(storage).failNext("save", "secret-key", cause);

    const error = await storage.save("secret-key", "secret-value").catch((e: unknown) => e);

    expect(error).toMatchObject({ code: VaultStorageErrorCode.Unavailable, cause });
    expect((error as Error).message).not.toMatch(/secret/);
  });

  it("replaces unreadable stored data instead of failing the save", async () => {
    const storage = create();
    backendOf(storage).store.set("key", CORRUPT);

    await storage.save("key", "fresh");

    await expect(storage.get("key")).resolves.toBe("fresh");
  });

  it("removes unreadable stored data", async () => {
    const storage = create();
    backendOf(storage).store.set("key", CORRUPT);

    await storage.remove("key");

    await expect(storage.get("key")).resolves.toBeNull();
  });

  it("does not write to the backend when the value is unchanged", async () => {
    const storage = create();
    await storage.save("key", { a: 1, b: 2 });
    const save = jest.spyOn(backendOf(storage), "save");

    await storage.save("key", { b: 2, a: 1 });

    expect(save).not.toHaveBeenCalled();
  });
});
