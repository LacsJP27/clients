/** The operations of {@link SecureStorage}, used when reporting or injecting failures. */
export type SecureStorageOperation = "get" | "has" | "save" | "remove";

/**
 * Platform-neutral storage for protected key material (ADR-0001), kept apart from `VaultStorage`
 * because the two make different promises: an implementation of this contract keeps values under
 * stronger protection than ordinary application storage, such as the operating system's keychain.
 *
 * Not every client can keep that promise. Whether this capability is supported, needs
 * configuration, is temporarily unavailable, or does not exist on a client is reported by the
 * capability status the client registers, and feature code obtains a `SecureStorage` only from a
 * status that reports it supported.
 *
 * Values are non-empty strings, opaque to the storage. Callers encode key material themselves.
 *
 * Guarantees, enforced by `runSecureStorageContract` in `@bitwarden/storage-test-utils`:
 * - **Absent value.** Reading a key that holds no value resolves to `null`, never `undefined`.
 * - **Read-your-writes.** Once a write's promise resolves, every later read observes it.
 * - **Explicit removal.** Only {@link remove} deletes. Saving anything that is not a non-empty
 *   string is rejected, so a missing value can never silently erase a stored secret.
 * - **No change notifications.** Secrets are handed only to the caller that asks for a key.
 * - **Errors.** Every method reports failure by rejecting with a `SecureStorageError`; none throws
 *   synchronously. A failed read is never reported as an absent value, a failed write leaves the
 *   stored value unchanged, and no error message contains a key or a value.
 *
 * Declared as an abstract class so it also serves as a runtime token.
 */
export abstract class SecureStorage {
  /** Resolves to the stored value, or `null` if the key is absent. */
  abstract get(key: string): Promise<string | null>;

  /** Resolves `true` exactly when {@link get} would resolve to a non-null value. */
  abstract has(key: string): Promise<boolean>;

  /** Stores `value` under `key`, replacing any previous value. */
  abstract save(key: string, value: string): Promise<void>;

  /** Deletes `key`. Removing an absent key resolves without error. */
  abstract remove(key: string): Promise<void>;
}
