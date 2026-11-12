import { Observable } from "rxjs";

/** Kind of change reported by {@link VaultStorage.updates$}. */
export type VaultStorageUpdateType = "save" | "remove";

/**
 * A committed change to one key.
 *
 * Structurally compatible with the existing `StorageUpdate` (`key` + `updateType`), so a service
 * can expose one stream that satisfies both.
 */
export interface VaultStorageUpdate {
  readonly key: string;
  readonly updateType: VaultStorageUpdateType;
  /** Value before the change, or `null` if the key was absent. A copy owned by the subscriber. */
  readonly oldValue: unknown;
  /** Value after the change, or `null` for a remove. A copy owned by the subscriber. */
  readonly newValue: unknown;
}

/**
 * Platform-neutral key/value storage for vault records and ordinary application state.
 *
 * Draft contract (ADR-0001, C3). The guarantees below are enforced by the shared behavioral suite
 * `runVaultStorageContract` in `@bitwarden/storage-test-utils`; open decisions are listed in
 * `OPEN_QUESTIONS.md` next to this file.
 *
 * Values are plain JSON data: `null`, booleans, finite numbers, strings, arrays, and plain objects.
 * Object properties whose value is `undefined` are dropped.
 *
 * Guarantees:
 * - **Absent value.** Reading a key that holds no value resolves to `null`, never `undefined`.
 * - **Read-your-writes.** Once a write's promise resolves, every later read observes it.
 * - **Isolation.** Values are copied on save, on read, and into notifications; mutating any of
 *   them never changes stored data.
 * - **Ordering.** Operations on a key take effect, and their promises settle, in call order.
 * - **Notifications.** {@link updates$} emits once per committed change, after the change is
 *   visible to reads and before the write's promise resolves. Writes that change nothing (saving a
 *   deep-equal value, removing an absent key) and failed writes do not emit. The stream does not
 *   replay past changes.
 * - **Errors.** Every method reports failure by rejecting with a `VaultStorageError`; none throws
 *   synchronously. A failed read is never reported as an absent value, and a failed write leaves
 *   stored data unchanged.
 *
 * Declared as an abstract class so it also serves as the runtime DI token.
 */
export abstract class VaultStorage {
  /** Resolves to a copy of the stored value, or `null` if the key is absent. */
  abstract get<T>(key: string): Promise<T | null>;

  /** Resolves `true` exactly when {@link get} would resolve to a non-null value. */
  abstract has(key: string): Promise<boolean>;

  /**
   * Stores a copy of `value` under `key`, replacing any previous value. Saving `null` or
   * `undefined` is equivalent to {@link remove}.
   */
  abstract save<T>(key: string, value: T): Promise<void>;

  /** Deletes `key`. Removing an absent key resolves without error and without notifying. */
  abstract remove(key: string): Promise<void>;

  /** Committed changes made through this storage. Hot; does not replay past changes. */
  abstract get updates$(): Observable<VaultStorageUpdate>;
}
