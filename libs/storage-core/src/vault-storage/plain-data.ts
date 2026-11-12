import { VaultStorageError, VaultStorageErrorCode } from "./vault-storage-error";

/**
 * Helpers shared by every {@link VaultStorage} implementation in this folder, so the reference
 * implementation and the adapter enforce the value domain and key rules identically.
 */

/** Rejects anything that is not a non-empty string with `INVALID_KEY`. */
export function assertValidKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0) {
    throw new VaultStorageError(VaultStorageErrorCode.InvalidKey);
  }
}

/** Serializes plain JSON data, rejecting anything JSON would silently drop or alter. */
export function serializePlainData(value: unknown): string {
  assertPlainData(value, new Set());
  return JSON.stringify(value);
}

/** Parses a stored value; unreadable data is `CORRUPT_DATA`, never an absent value. */
export function parsePlainData(serialized: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch (error) {
    throw new VaultStorageError(VaultStorageErrorCode.CorruptData, undefined, { cause: error });
  }
}

/** Serialization with sorted object keys, used to detect deep-equal (no-op) saves. */
export function canonicalJson(serialized: string): string {
  return JSON.stringify(JSON.parse(serialized), (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
}

function assertPlainData(value: unknown, ancestors: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw notSerializable();
    }
    return;
  }
  if (typeof value !== "object") {
    // function, symbol, bigint, or undefined in a position JSON cannot represent.
    throw notSerializable();
  }

  if (ancestors.has(value)) {
    throw notSerializable();
  }
  const prototype = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    // Class instances, Date, Map, Set, typed arrays, ...
    throw notSerializable();
  }

  ancestors.add(value);
  for (const child of Object.values(value)) {
    if (child === undefined && !isArray) {
      continue;
    }
    assertPlainData(child, ancestors);
  }
  ancestors.delete(value);
}

function notSerializable(): VaultStorageError {
  return new VaultStorageError(VaultStorageErrorCode.NotSerializable);
}
