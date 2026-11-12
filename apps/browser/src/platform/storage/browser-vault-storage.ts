import {
  VaultStorageAdapter,
  VaultStorageBackend,
  VaultStorageErrorCode,
} from "@bitwarden/storage-core";

/**
 * Translates an extension storage failure. The storage API reports failures as
 * `runtime.lastError`, an object whose only field is a message, so the quota case can only be
 * recognized by that message (`QUOTA_BYTES quota exceeded`, `QuotaExceededError`, ...).
 */
export function browserVaultStorageErrorCode(error: unknown): VaultStorageErrorCode | undefined {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && /quota/i.test(message)
    ? VaultStorageErrorCode.QuotaExceeded
    : undefined;
}

/**
 * The browser extension's `VaultStorage` (ADR-0001), over the extension's existing storage
 * service. That service keeps its storage format, so existing data needs no migration.
 */
export class BrowserVaultStorage extends VaultStorageAdapter {
  constructor(storage: VaultStorageBackend) {
    super(storage, { mapError: browserVaultStorageErrorCode });
  }
}
