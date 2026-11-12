import {
  VaultStorageAdapter,
  VaultStorageBackend,
  VaultStorageErrorCode,
} from "@bitwarden/storage-core";

/** Names browsers give the error thrown when a write does not fit in web storage. */
const QUOTA_ERROR_NAMES = new Set(["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"]);

/** Translates a web storage failure. */
export function webVaultStorageErrorCode(error: unknown): VaultStorageErrorCode | undefined {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" && QUOTA_ERROR_NAMES.has(name)
    ? VaultStorageErrorCode.QuotaExceeded
    : undefined;
}

/**
 * The web vault's `VaultStorage` (ADR-0001), over its existing window storage service. Which
 * storage area backs it (session or local) is decided where it is registered.
 */
export class WebVaultStorage extends VaultStorageAdapter {
  constructor(storage: VaultStorageBackend) {
    super(storage, { mapError: webVaultStorageErrorCode });
  }
}
