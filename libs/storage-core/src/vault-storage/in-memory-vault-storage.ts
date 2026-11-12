import { Observable, Subscriber } from "rxjs";

import { assertValidKey, canonicalJson, parsePlainData, serializePlainData } from "./plain-data";
import {
  VaultStorage,
  VaultStorageOperation,
  VaultStorageUpdate,
  VaultStorageUpdateType,
} from "./vault-storage";
import { VaultStorageError, VaultStorageErrorCode } from "./vault-storage-error";

export interface InMemoryVaultStorageOptions {
  /**
   * Maximum total size, in UTF-16 code units of key plus serialized value, across all entries.
   * A save that would exceed it rejects with `QUOTA_EXCEEDED` and changes nothing.
   */
  quota?: number;
}

type ArmedFailure = {
  operation: VaultStorageOperation;
  code: VaultStorageErrorCode;
  key: string | undefined;
};

/**
 * Reference implementation of {@link VaultStorage} (ADR-0001, C5). Holds data in memory only.
 *
 * Values are kept as serialized JSON, so every read, write, and notification works on a fresh copy.
 */
export class InMemoryVaultStorage extends VaultStorage {
  private readonly entries = new Map<string, string>();
  private readonly subscribers = new Set<Subscriber<VaultStorageUpdate>>();
  private readonly armedFailures: ArmedFailure[] = [];
  private readonly quota: number;

  readonly updates$ = new Observable<VaultStorageUpdate>((subscriber) => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  });

  constructor(options: InMemoryVaultStorageOptions = {}) {
    super();
    this.quota = options.quota ?? Number.POSITIVE_INFINITY;
  }

  async get<T>(key: string): Promise<T | null> {
    assertValidKey(key);
    this.throwIfArmed("get", key);
    const serialized = this.entries.get(key);
    return serialized === undefined ? null : (parsePlainData(serialized) as T);
  }

  async has(key: string): Promise<boolean> {
    assertValidKey(key);
    this.throwIfArmed("has", key);
    return this.entries.has(key);
  }

  async save<T>(key: string, value: T): Promise<void> {
    assertValidKey(key);
    if (value === null || value === undefined) {
      return this.remove(key);
    }

    const serialized = serializePlainData(value);
    this.throwIfArmed("save", key);

    const previous = this.entries.get(key);
    if (previous !== undefined && canonicalJson(previous) === canonicalJson(serialized)) {
      return;
    }
    if (this.sizeWith(key, serialized) > this.quota) {
      throw new VaultStorageError(VaultStorageErrorCode.QuotaExceeded);
    }

    this.entries.set(key, serialized);
    this.notify(key, "save", previous, serialized);
  }

  async remove(key: string): Promise<void> {
    assertValidKey(key);
    this.throwIfArmed("remove", key);

    const previous = this.entries.get(key);
    if (previous === undefined) {
      return;
    }

    this.entries.delete(key);
    this.notify(key, "remove", previous, undefined);
  }

  /**
   * Fault injection for tests: the next `operation` (on `key`, or on any key if omitted) rejects
   * with `code` and changes nothing. Each call arms one failure.
   */
  failNext(operation: VaultStorageOperation, code: VaultStorageErrorCode, key?: string): void {
    this.armedFailures.push({ operation, code, key });
  }

  private throwIfArmed(operation: VaultStorageOperation, key: string): void {
    const index = this.armedFailures.findIndex(
      (failure) =>
        failure.operation === operation && (failure.key === undefined || failure.key === key),
    );
    if (index !== -1) {
      const [failure] = this.armedFailures.splice(index, 1);
      throw new VaultStorageError(failure.code);
    }
  }

  private sizeWith(key: string, serialized: string): number {
    let size = key.length + serialized.length;
    for (const [existingKey, existing] of this.entries) {
      if (existingKey !== key) {
        size += existingKey.length + existing.length;
      }
    }
    return size;
  }

  private notify(
    key: string,
    updateType: VaultStorageUpdateType,
    previous: string | undefined,
    next: string | undefined,
  ): void {
    for (const subscriber of [...this.subscribers]) {
      subscriber.next({
        key,
        updateType,
        oldValue: previous === undefined ? null : parsePlainData(previous),
        newValue: next === undefined ? null : parsePlainData(next),
      });
    }
  }
}
