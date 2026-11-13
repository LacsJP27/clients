import { Observable, Subject, map } from "rxjs";

import {
  VaultStorage,
  VaultStorageError,
  VaultStorageErrorCode,
  VaultStorageUpdate,
} from "@bitwarden/storage-core";

import { runVaultStorageContract } from "./run-vault-storage-contract";

/**
 * A second, independently written implementation that reuses the suite with nothing but a
 * `createStorage` function. Unlike the in-memory reference, every operation goes through an
 * asynchronous queue with a varying number of hops, the way a real backend would, which exercises
 * the ordering and notification-timing guarantees.
 */
class QueuedVaultStorage extends VaultStorage {
  private readonly data: Record<string, string> = {};
  private readonly changes = new Subject<{
    key: string;
    updateType: "save" | "remove";
    old?: string;
    next?: string;
  }>();
  private queue: Promise<unknown> = Promise.resolve();
  private hops = 0;

  readonly updates$: Observable<VaultStorageUpdate> = this.changes.pipe(
    map(({ key, updateType, old, next }) => ({
      key,
      updateType,
      oldValue: old === undefined ? null : JSON.parse(old),
      newValue: next === undefined ? null : JSON.parse(next),
    })),
  );

  get<T>(key: string): Promise<T | null> {
    return this.enqueue(key, () => {
      const raw = this.data[key];
      return raw === undefined ? null : (JSON.parse(raw) as T);
    });
  }

  has(key: string): Promise<boolean> {
    return this.enqueue(key, () => key in this.data);
  }

  save<T>(key: string, value: T): Promise<void> {
    if (value == null) {
      return this.remove(key);
    }
    let serialized: string;
    try {
      // Serializing first rejects cycles and bigints, so the check below always terminates.
      serialized = JSON.stringify(value);
      assertJsonData(value);
    } catch (error) {
      return Promise.reject(
        new VaultStorageError(VaultStorageErrorCode.NotSerializable, undefined, { cause: error }),
      );
    }
    return this.enqueue(key, () => {
      const old = this.data[key];
      if (old !== undefined && sortedJson(old) === sortedJson(serialized)) {
        return;
      }
      this.data[key] = serialized;
      this.changes.next({ key, updateType: "save", old, next: serialized });
    });
  }

  remove(key: string): Promise<void> {
    return this.enqueue(key, () => {
      const old = this.data[key];
      if (old === undefined) {
        return;
      }
      delete this.data[key];
      this.changes.next({ key, updateType: "remove", old });
    });
  }

  private enqueue<R>(key: string, operation: () => R): Promise<R> {
    if (typeof key !== "string" || key === "") {
      return Promise.reject(new VaultStorageError(VaultStorageErrorCode.InvalidKey));
    }
    const hops = (this.hops = (this.hops + 1) % 4);
    const result = this.queue.then(async () => {
      for (let i = 0; i < hops; i++) {
        await Promise.resolve();
      }
      return operation();
    });
    this.queue = result.catch((): void => undefined);
    return result;
  }
}

/** Throws for anything that is not plain JSON data, including what JSON would silently convert. */
function assertJsonData(value: unknown): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertJsonData);
    return;
  }
  const prototype = typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (prototype === Object.prototype || prototype === null) {
    Object.values(value as object)
      .filter((child) => child !== undefined)
      .forEach(assertJsonData);
    return;
  }
  throw new TypeError("not JSON data");
}

function sortedJson(serialized: string): string {
  return JSON.stringify(JSON.parse(serialized), (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value,
  );
}

runVaultStorageContract(
  "QueuedVaultStorage (second implementation)",
  () => new QueuedVaultStorage(),
);
