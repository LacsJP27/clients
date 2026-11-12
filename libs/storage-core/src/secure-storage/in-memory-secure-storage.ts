import { SecureStorage, SecureStorageOperation } from "./secure-storage";
import { SecureStorageError, SecureStorageErrorCode } from "./secure-storage-error";
import { assertValidSecureKey, assertValidSecureValue } from "./secure-values";

type ArmedFailure = {
  operation: SecureStorageOperation;
  code: SecureStorageErrorCode;
  key: string | undefined;
};

/**
 * Reference implementation of {@link SecureStorage}, for tests and for defining the contract's
 * behavior. It holds values in memory and protects nothing, so it must never be registered as a
 * client's secure storage.
 */
export class InMemorySecureStorage extends SecureStorage {
  private readonly entries = new Map<string, string>();
  private readonly armedFailures: ArmedFailure[] = [];

  async get(key: string): Promise<string | null> {
    assertValidSecureKey(key);
    this.throwIfArmed("get", key);
    return this.entries.get(key) ?? null;
  }

  async has(key: string): Promise<boolean> {
    assertValidSecureKey(key);
    this.throwIfArmed("has", key);
    return this.entries.has(key);
  }

  async save(key: string, value: string): Promise<void> {
    assertValidSecureKey(key);
    assertValidSecureValue(value);
    this.throwIfArmed("save", key);
    this.entries.set(key, value);
  }

  async remove(key: string): Promise<void> {
    assertValidSecureKey(key);
    this.throwIfArmed("remove", key);
    this.entries.delete(key);
  }

  /**
   * Fault injection for tests: the next `operation` (on `key`, or on any key if omitted) rejects
   * with `code` and changes nothing. Each call arms one failure.
   */
  failNext(operation: SecureStorageOperation, code: SecureStorageErrorCode, key?: string): void {
    this.armedFailures.push({ operation, code, key });
  }

  private throwIfArmed(operation: SecureStorageOperation, key: string): void {
    const index = this.armedFailures.findIndex(
      (failure) =>
        failure.operation === operation && (failure.key === undefined || failure.key === key),
    );
    if (index !== -1) {
      const [failure] = this.armedFailures.splice(index, 1);
      throw new SecureStorageError(failure.code);
    }
  }
}
