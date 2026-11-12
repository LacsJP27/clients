import {
  VaultStorageAdapter,
  VaultStorageBackend,
  VaultStorageErrorCode,
} from "@bitwarden/storage-core";

/** Operating-system error codes for "no room left to write". */
const OUT_OF_SPACE = new Set(["ENOSPC", "EDQUOT"]);

/** Translates a failure of the CLI's data file. */
export function cliVaultStorageErrorCode(error: unknown): VaultStorageErrorCode | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && OUT_OF_SPACE.has(code)
    ? VaultStorageErrorCode.QuotaExceeded
    : undefined;
}

/**
 * The CLI's `VaultStorage` (ADR-0001), over its existing data-file storage service, which keeps
 * its file format.
 *
 * The data file addresses values by path, so a key containing `.` or `[` names a nested value
 * there. Keys in use today contain neither.
 */
export class CliVaultStorage extends VaultStorageAdapter {
  constructor(storage: VaultStorageBackend) {
    super(storage, { mapError: cliVaultStorageErrorCode });
  }
}
