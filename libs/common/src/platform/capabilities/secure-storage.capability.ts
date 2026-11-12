import { Observable, of } from "rxjs";

import { SecureStorage } from "@bitwarden/storage-core";

import { SupportStatus } from "../misc/support-status";

import { CapabilityStatus, PlatformCapability } from "./platform-capability";

/** Documented reasons a client reports for secure storage that is not ready to use. */
export const SecureStorageStatusReason = Object.freeze({
  /** The client's platform has no storage with stronger protection than ordinary storage. */
  NoProtectedStorage: "no-protected-storage",
  /** Protected storage exists but this installation is set up to keep its data elsewhere. */
  DisabledForInstallation: "disabled-for-installation",
  /** The key that protects stored values has to be supplied before values can be read or written. */
  ProtectingKeyRequired: "protecting-key-required",
} as const);

export type SecureStorageStatusReason =
  (typeof SecureStorageStatusReason)[keyof typeof SecureStorageStatusReason];

/**
 * The secure storage capability and its runtime token. Every client registers one; clients whose
 * platform has no protected storage register {@link UnsupportedSecureStorageCapability} rather
 * than passing ordinary storage off as secure.
 */
export abstract class SecureStorageCapability extends PlatformCapability<SecureStorage> {}

/** For clients whose platform has no protected storage. */
export class UnsupportedSecureStorageCapability extends SecureStorageCapability {
  readonly status$: Observable<SupportStatus<SecureStorage>>;

  constructor(reason: SecureStorageStatusReason = SecureStorageStatusReason.NoProtectedStorage) {
    super();
    this.status$ = of(CapabilityStatus.notSupported(reason));
  }
}
