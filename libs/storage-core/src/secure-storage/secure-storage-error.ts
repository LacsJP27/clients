/**
 * Platform-neutral failure codes for {@link SecureStorage}. Adapters translate their platform's
 * native failures into one of these at the adapter boundary.
 */
export const SecureStorageErrorCode = Object.freeze({
  /** The key is not a non-empty string. */
  InvalidKey: "INVALID_KEY",
  /** The value is not a non-empty string. Nothing was written. */
  InvalidValue: "INVALID_VALUE",
  /** The platform refused access: the user dismissed a prompt, or the protecting key is missing. */
  AccessDenied: "ACCESS_DENIED",
  /** A value exists for the key but cannot be decoded. Never reported as an absent value. */
  CorruptData: "CORRUPT_DATA",
  /** The protected store could not be reached or failed for a reason not listed above. */
  Unavailable: "UNAVAILABLE",
} as const);

export type SecureStorageErrorCode =
  (typeof SecureStorageErrorCode)[keyof typeof SecureStorageErrorCode];

/**
 * The only error type a {@link SecureStorage} implementation may reject with.
 *
 * Messages must never contain stored values, keys, or other user data; use {@link code} to branch
 * and {@link cause} to keep the original platform error for diagnostics.
 */
export class SecureStorageError extends Error {
  readonly name = "SecureStorageError";
  readonly cause: unknown;

  constructor(
    readonly code: SecureStorageErrorCode,
    message: string = code,
    options?: { cause?: unknown },
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.cause = options?.cause;
  }
}

/** Type guard for {@link SecureStorageError}, optionally narrowed to one code. */
export function isSecureStorageError(
  error: unknown,
  code?: SecureStorageErrorCode,
): error is SecureStorageError {
  return error instanceof SecureStorageError && (code === undefined || error.code === code);
}
