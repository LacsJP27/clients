import {
  VaultStorageAdapter,
  VaultStorageBackend,
  VaultStorageErrorCode,
} from "@bitwarden/storage-core";

/** Operating-system error codes for "no room left to write". */
const OUT_OF_SPACE = /\b(ENOSPC|EDQUOT)\b/;

/**
 * Translates a desktop storage failure. In the main process the operating-system code is on the
 * error; in the renderer the failure crossed the process boundary and only its message survived.
 */
export function desktopVaultStorageErrorCode(error: unknown): VaultStorageErrorCode | undefined {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const outOfSpace =
    (typeof code === "string" && OUT_OF_SPACE.test(code)) ||
    (typeof message === "string" && OUT_OF_SPACE.test(message));
  return outOfSpace ? VaultStorageErrorCode.QuotaExceeded : undefined;
}

/**
 * The desktop app's `VaultStorage` (ADR-0001). The same adapter serves both processes; each
 * registers it over its own existing storage service (the store in the main process, the bridge
 * to it in the renderer).
 *
 * A resolved write is visible to later reads. It reaches disk when the main process flushes its
 * debounced store, and a failure of that flush is not reported to the writer.
 */
export class DesktopVaultStorage extends VaultStorageAdapter {
  constructor(storage: VaultStorageBackend) {
    super(storage, { mapError: desktopVaultStorageErrorCode });
  }
}
