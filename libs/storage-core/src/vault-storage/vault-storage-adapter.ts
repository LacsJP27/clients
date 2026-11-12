import { Observable, Subscriber } from "rxjs";

import { assertValidKey, canonicalJson, parsePlainData, serializePlainData } from "./plain-data";
import {
  VaultStorage,
  VaultStorageOperation,
  VaultStorageUpdate,
  VaultStorageUpdateType,
} from "./vault-storage";
import {
  VaultStorageError,
  VaultStorageErrorCode,
  isVaultStorageError,
} from "./vault-storage-error";

/**
 * The key/value operations a client's storage has to offer for {@link VaultStorageAdapter} to
 * build a {@link VaultStorage} on top of it.
 *
 * It is declared structurally, so the storage services the clients already have satisfy it
 * without importing anything from here. A backend may return values synchronously, throw
 * synchronously, report an absent key as `null` or `undefined`, and hand out live references:
 * the adapter normalizes all of that.
 */
export interface VaultStorageBackend {
  get(key: string): unknown;
  save(key: string, value: unknown): unknown;
  remove(key: string): unknown;
}

/**
 * Translates one client's native failure into a contract error code. Return `undefined` to accept
 * the default: `CORRUPT_DATA` for a parse failure on read, otherwise `UNAVAILABLE`.
 */
export type VaultStorageErrorMapper = (
  error: unknown,
  operation: VaultStorageOperation,
) => VaultStorageErrorCode | undefined;

export interface VaultStorageAdapterOptions {
  /** The client's platform error translation. */
  mapError?: VaultStorageErrorMapper;
}

type StoredValue = { serialized: string | undefined; unreadable: boolean };

/**
 * Builds a {@link VaultStorage} over a client's existing storage (ADR-0001, component 2).
 *
 * Everything the contract promises that is not specific to one platform lives here, once: key and
 * value validation, isolation, per-key ordering, no-op detection, notifications, and the error
 * model. A client adapter supplies only the backend and its platform error translation, so the
 * client-specific code stays small enough to read in full.
 *
 * The backend's own storage format is untouched: values are handed to it as plain JSON data, the
 * way existing callers already do, so data written before this adapter existed stays readable.
 *
 * Notifications cover changes made through this instance only.
 */
export class VaultStorageAdapter extends VaultStorage {
  private readonly subscribers = new Set<Subscriber<VaultStorageUpdate>>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly mapError: VaultStorageErrorMapper | undefined;

  readonly updates$ = new Observable<VaultStorageUpdate>((subscriber) => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  });

  constructor(
    private readonly backend: VaultStorageBackend,
    options: VaultStorageAdapterOptions = {},
  ) {
    super();
    this.mapError = options.mapError;
  }

  async get<T>(key: string): Promise<T | null> {
    assertValidKey(key);
    return this.enqueue(key, async () => {
      const { serialized } = await this.read(key, "get", { tolerateUnreadable: false });
      return serialized === undefined ? null : (parsePlainData(serialized) as T);
    });
  }

  async has(key: string): Promise<boolean> {
    assertValidKey(key);
    return this.enqueue(key, async () => {
      const { serialized } = await this.read(key, "has", { tolerateUnreadable: false });
      return serialized !== undefined;
    });
  }

  async save<T>(key: string, value: T): Promise<void> {
    assertValidKey(key);
    if (value === null || value === undefined) {
      return this.remove(key);
    }

    const serialized = serializePlainData(value);
    return this.enqueue(key, async () => {
      // Unreadable existing data must not block replacing it.
      const previous = await this.read(key, "save", { tolerateUnreadable: true });
      if (
        previous.serialized !== undefined &&
        canonicalJson(previous.serialized) === canonicalJson(serialized)
      ) {
        return;
      }

      await this.call("save", () => this.backend.save(key, JSON.parse(serialized)));
      this.notify(key, "save", previous.serialized, serialized);
    });
  }

  async remove(key: string): Promise<void> {
    assertValidKey(key);
    return this.enqueue(key, async () => {
      const previous = await this.read(key, "remove", { tolerateUnreadable: true });
      if (previous.serialized === undefined && !previous.unreadable) {
        return;
      }

      await this.call("remove", () => this.backend.remove(key));
      this.notify(key, "remove", previous.serialized, undefined);
    });
  }

  /**
   * Reads the backend's current value as serialized JSON. Serializing here is what isolates
   * callers from a backend that hands out live references.
   */
  private async read(
    key: string,
    operation: VaultStorageOperation,
    { tolerateUnreadable }: { tolerateUnreadable: boolean },
  ): Promise<StoredValue> {
    try {
      const value = await this.call(operation, () => this.backend.get(key), { reading: true });
      if (value === null || value === undefined) {
        return { serialized: undefined, unreadable: false };
      }
      return { serialized: stringifyStored(value), unreadable: false };
    } catch (error) {
      if (tolerateUnreadable && isVaultStorageError(error, VaultStorageErrorCode.CorruptData)) {
        return { serialized: undefined, unreadable: true };
      }
      throw error;
    }
  }

  /** Runs one backend call, turning a synchronous throw or a rejection into a contract error. */
  private async call<R>(
    operation: VaultStorageOperation,
    action: () => R,
    { reading }: { reading: boolean } = { reading: false },
  ): Promise<Awaited<R>> {
    try {
      return await action();
    } catch (error) {
      if (isVaultStorageError(error)) {
        throw error;
      }
      const code =
        this.mapError?.(error, operation) ??
        (reading && isParseFailure(error)
          ? VaultStorageErrorCode.CorruptData
          : VaultStorageErrorCode.Unavailable);
      throw new VaultStorageError(code, undefined, { cause: error });
    }
  }

  /**
   * Runs `operation` after every earlier operation on `key` has settled, which is what makes
   * operations on a key take effect, and settle, in call order whatever the backend's timing.
   */
  private enqueue<R>(key: string, operation: () => Promise<R>): Promise<R> {
    const result = (this.queues.get(key) ?? Promise.resolve()).then(operation);
    const settled = (): void => undefined;
    const tail = result.then(settled, settled);
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) {
        this.queues.delete(key);
      }
    });
    return result;
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

function stringifyStored(value: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new VaultStorageError(VaultStorageErrorCode.CorruptData, undefined, { cause: error });
  }
  if (serialized === undefined) {
    throw new VaultStorageError(VaultStorageErrorCode.CorruptData);
  }
  return serialized;
}

/** By name, because an error thrown in another realm fails `instanceof SyntaxError`. */
function isParseFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "SyntaxError"
  );
}
