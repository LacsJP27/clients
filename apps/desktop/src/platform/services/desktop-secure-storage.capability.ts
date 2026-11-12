import { Observable, of } from "rxjs";

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
  SecureStorageErrorCode,
} from "@bitwarden/storage-core";

/**
 * The desktop app's `SecureStorage` (ADR-0001), over its existing bridge to the operating
 * system's credential store. That bridge keeps its stored format, so existing entries stay
 * readable; an entry it cannot decode is reported as corrupt rather than absent.
 */
export class DesktopSecureStorage extends SecureStorageAdapter {
  constructor(credentialStore: SecureStorageBackend) {
    super(credentialStore, {
      mapError: (error) =>
        (error as { name?: unknown } | null)?.name === "SyntaxError"
          ? SecureStorageErrorCode.CorruptData
          : undefined,
    });
  }
}

/**
 * Reports the desktop app's secure storage. It is supported unless this installation keeps its
 * data out of the operating system's credential store (a portable installation, or one configured
 * to store on disk), which bootstrap decides and passes in.
 */
export class DesktopSecureStorageCapability extends SecureStorageCapability {
  readonly status$: Observable<SupportStatus<SecureStorage>>;

  constructor(credentialStore: SecureStorageBackend, usesCredentialStore: boolean) {
    super();
    this.status$ = of(
      usesCredentialStore
        ? CapabilityStatus.supported(new DesktopSecureStorage(credentialStore))
        : CapabilityStatus.notSupported(SecureStorageStatusReason.DisabledForInstallation),
    );
  }
}
