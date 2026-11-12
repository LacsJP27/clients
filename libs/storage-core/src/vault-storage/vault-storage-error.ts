/**
 * Platform-neutral failure codes for {@link VaultStorage}. Adapters translate their platform's
 * native failures into one of these at the adapter boundary.
 */
export const VaultStorageErrorCode = Object.freeze({
  /** The key is not a non-empty string. */
  InvalidKey: "INVALID_KEY",
  /** The value cannot be stored as plain JSON data (functions, symbols, bigints, cycles, ...). */
  NotSerializable: "NOT_SERIALIZABLE",
  /** The write would exceed the storage area's capacity. Nothing was written. */
  QuotaExceeded: "QUOTA_EXCEEDED",
  /** A value exists for the key but cannot be decoded. Never reported as an absent value. */
  CorruptData: "CORRUPT_DATA",
  /** The underlying storage could not be reached or failed for a reason not listed above. */
  Unavailable: "UNAVAILABLE",
} as const);

export type VaultStorageErrorCode =
  (typeof VaultStorageErrorCode)[keyof typeof VaultStorageErrorCode];

/**
 * The only error type a {@link VaultStorage} implementation may reject with.
 *
 * Messages must never contain stored values, keys, or other user data; use {@link code} to branch
 * and {@link cause} to keep the original platform error for diagnostics.
 */
export class VaultStorageError extends Error {
  readonly name = "VaultStorageError";
  readonly cause: unknown;

  constructor(
    readonly code: VaultStorageErrorCode,
    message: string = code,
    options?: { cause?: unknown },
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.cause = options?.cause;
  }
}

/** Type guard for {@link VaultStorageError}, optionally narrowed to one code. */
export function isVaultStorageError(
  error: unknown,
  code?: VaultStorageErrorCode,
): error is VaultStorageError {
  return error instanceof VaultStorageError && (code === undefined || error.code === code);
}
