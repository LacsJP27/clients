import { Observable, defer, of } from "rxjs";

import { CapabilityStatus } from "@bitwarden/common/platform/capabilities/platform-capability";
import {
  SecureStorageCapability,
  SecureStorageStatusReason,
} from "@bitwarden/common/platform/capabilities/secure-storage.capability";
import { SupportStatus } from "@bitwarden/common/platform/misc/support-status";
import {
  SecureStorage,
  SecureStorageAdapter,
  SecureStorageBackend,
  SecureStorageError,
  SecureStorageErrorCode,
} from "@bitwarden/storage-core";

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * The CLI's `SecureStorage` (ADR-0001), over its existing session-protected storage service,
 * which keeps its stored format.
 *
 * Two behaviors of that service are made explicit here rather than passed on:
 * - It stores Base64 text only. Any other value is rejected with `INVALID_VALUE` instead of being
 *   stored in a form that cannot be read back.
 * - It answers "absent" when a value exists but the current session cannot unlock it. That case is
 *   reported as `ACCESS_DENIED`, so a stale session is never mistaken for a missing value.
 */
export class CliSecureStorage extends SecureStorageAdapter {
  /**
   * @param protectedStorage The existing session-protected storage service.
   * @param hasProtectedValue Whether a protected value is stored for a key, readable or not.
   * @param hasSessionKey Whether the key that protects stored values is present.
   */
  constructor(
    protectedStorage: SecureStorageBackend,
    hasProtectedValue: (key: string) => Promise<boolean>,
    hasSessionKey: () => boolean,
  ) {
    super({
      get: async (key) => {
        const value = await protectedStorage.get(key);
        if ((value === null || value === undefined) && (await hasProtectedValue(key))) {
          throw new SecureStorageError(SecureStorageErrorCode.AccessDenied);
        }
        return value;
      },
      save: async (key, value) => {
        if (!BASE64.test(value)) {
          throw new SecureStorageError(SecureStorageErrorCode.InvalidValue);
        }
        if (!hasSessionKey()) {
          throw new SecureStorageError(SecureStorageErrorCode.AccessDenied);
        }
        await protectedStorage.save(key, value);
      },
      remove: (key) => protectedStorage.remove(key),
    });
  }
}

/**
 * Reports the CLI's secure storage: ready while a session key is present, and otherwise in need of
 * one. Bootstrap supplies the check, so this class reads nothing from the environment itself.
 */
export class CliSecureStorageCapability extends SecureStorageCapability {
  readonly status$: Observable<SupportStatus<SecureStorage>>;

  constructor(storage: SecureStorage, hasSessionKey: () => boolean) {
    super();
    this.status$ = defer(() =>
      of(
        hasSessionKey()
          ? CapabilityStatus.supported(storage)
          : CapabilityStatus.needsConfiguration(SecureStorageStatusReason.ProtectingKeyRequired),
      ),
    );
  }
}
