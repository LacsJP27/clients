import { SecureStorage, SecureStorageOperation } from "./secure-storage";
import {
  SecureStorageError,
  SecureStorageErrorCode,
  isSecureStorageError,
} from "./secure-storage-error";
import { assertValidSecureKey, assertValidSecureValue } from "./secure-values";

/**
 * The operations a client's protected store has to offer for {@link SecureStorageAdapter} to build
 * a {@link SecureStorage} on top of it. Declared structurally, so the services the clients already
 * have satisfy it without importing anything from here.
 */
export interface SecureStorageBackend {
  get(key: string): unknown;
  save(key: string, value: string): unknown;
  remove(key: string): unknown;
}

/**
 * Translates one client's native failure into a contract error code. Return `undefined` to accept
 * the default, `UNAVAILABLE`.
 */
export type SecureStorageErrorMapper = (
  error: unknown,
  operation: SecureStorageOperation,
) => SecureStorageErrorCode | undefined;

export interface SecureStorageAdapterOptions {
  /** The client's platform error translation. */
  mapError?: SecureStorageErrorMapper;
}

/**
 * Builds a {@link SecureStorage} over a client's existing protected store (ADR-0001, component 2).
 * The platform-independent rules live here once: key and value validation, the absent value, and
 * the error model. A client adapter supplies the backend and its platform error translation.
 *
 * The backend keeps its own storage format, so values stored before this adapter existed stay
 * readable.
 */
export class SecureStorageAdapter extends SecureStorage {
  private readonly mapError: SecureStorageErrorMapper | undefined;

  constructor(
    private readonly backend: SecureStorageBackend,
    options: SecureStorageAdapterOptions = {},
  ) {
    super();
    this.mapError = options.mapError;
  }

  async get(key: string): Promise<string | null> {
    assertValidSecureKey(key);
    return this.read(key, "get");
  }

  async has(key: string): Promise<boolean> {
    assertValidSecureKey(key);
    return (await this.read(key, "has")) !== null;
  }

  async save(key: string, value: string): Promise<void> {
    assertValidSecureKey(key);
    assertValidSecureValue(value);
    await this.call("save", () => this.backend.save(key, value));
  }

  async remove(key: string): Promise<void> {
    assertValidSecureKey(key);
    await this.call("remove", () => this.backend.remove(key));
  }

  private async read(key: string, operation: SecureStorageOperation): Promise<string | null> {
    const value = await this.call(operation, () => this.backend.get(key));
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new SecureStorageError(SecureStorageErrorCode.CorruptData);
    }
    return value;
  }

  /** Runs one backend call, turning a synchronous throw or a rejection into a contract error. */
  private async call<R>(operation: SecureStorageOperation, action: () => R): Promise<Awaited<R>> {
    try {
      return await action();
    } catch (error) {
      if (isSecureStorageError(error)) {
        throw error;
      }
      const code = this.mapError?.(error, operation) ?? SecureStorageErrorCode.Unavailable;
      throw new SecureStorageError(code, undefined, { cause: error });
    }
  }
}
