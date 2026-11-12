import { SecureStorageError, SecureStorageErrorCode } from "./secure-storage-error";

/** Rejects anything that is not a non-empty string with `INVALID_KEY`. */
export function assertValidSecureKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0) {
    throw new SecureStorageError(SecureStorageErrorCode.InvalidKey);
  }
}

/** Rejects anything that is not a non-empty string with `INVALID_VALUE`. */
export function assertValidSecureValue(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SecureStorageError(SecureStorageErrorCode.InvalidValue);
  }
}
