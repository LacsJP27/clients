import { Observable, defer, from, map } from "rxjs";

import {
  CapabilityStatus,
  PlatformCapability,
} from "@bitwarden/common/platform/capabilities/platform-capability";
import { SupportStatus } from "@bitwarden/common/platform/misc/support-status";

import { BiometricsService } from "./biometric.service";
import { BiometricsStatus } from "./biometrics-status";

/**
 * Verification of the person at the device by the operating system (ADR-0001), without any
 * platform type in its signature. Unlocking with a stored key is deliberately not part of it.
 */
export abstract class SystemAuthentication {
  /** Asks the system to verify the user. Resolves `true` only when verification succeeded. */
  abstract verifyUser(): Promise<boolean>;
}

/** The system authentication capability and its runtime token. */
export abstract class SystemAuthenticationCapability extends PlatformCapability<SystemAuthentication> {}

/** Documented reasons a client reports for system authentication that is not ready to use. */
export const SystemAuthenticationStatusReason = Object.freeze({
  UnlockNeeded: "unlock-needed",
  HardwareUnavailable: "hardware-unavailable",
  DesktopDisconnected: "desktop-disconnected",
  AutoSetupNeeded: "auto-setup-needed",
  ManualSetupNeeded: "manual-setup-needed",
  NotEnabledLocally: "not-enabled-locally",
  NotEnabledInConnectedDesktopApp: "not-enabled-in-connected-desktop-app",
  NativeMessagingPermissionMissing: "native-messaging-permission-missing",
  PlatformUnsupported: "platform-unsupported",
} as const);

export type SystemAuthenticationStatusReason =
  (typeof SystemAuthenticationStatusReason)[keyof typeof SystemAuthenticationStatusReason];

const Reason = SystemAuthenticationStatusReason;

/**
 * Sorts each platform biometrics status into one of the four capability states: ready, something
 * the user has to set up, something that may come back without the user, or absent on the client.
 */
export function toSystemAuthenticationStatus(
  status: BiometricsStatus,
  service: SystemAuthentication,
): SupportStatus<SystemAuthentication> {
  switch (status) {
    case BiometricsStatus.Available:
      return CapabilityStatus.supported(service);
    case BiometricsStatus.UnlockNeeded:
      return CapabilityStatus.unavailable(Reason.UnlockNeeded);
    case BiometricsStatus.HardwareUnavailable:
      return CapabilityStatus.unavailable(Reason.HardwareUnavailable);
    case BiometricsStatus.DesktopDisconnected:
      return CapabilityStatus.unavailable(Reason.DesktopDisconnected);
    case BiometricsStatus.AutoSetupNeeded:
      return CapabilityStatus.needsConfiguration(Reason.AutoSetupNeeded);
    case BiometricsStatus.ManualSetupNeeded:
      return CapabilityStatus.needsConfiguration(Reason.ManualSetupNeeded);
    case BiometricsStatus.NotEnabledLocally:
      return CapabilityStatus.needsConfiguration(Reason.NotEnabledLocally);
    case BiometricsStatus.NotEnabledInConnectedDesktopApp:
      return CapabilityStatus.needsConfiguration(Reason.NotEnabledInConnectedDesktopApp);
    case BiometricsStatus.NativeMessagingPermissionMissing:
      return CapabilityStatus.needsConfiguration(Reason.NativeMessagingPermissionMissing);
    case BiometricsStatus.PlatformUnsupported:
    default:
      return CapabilityStatus.notSupported(Reason.PlatformUnsupported);
  }
}

/**
 * Reports the capability from the biometrics service a client already registers. Every client has
 * one, so this single adapter serves them all; the status is read afresh on each subscription.
 */
export class DefaultSystemAuthenticationCapability extends SystemAuthenticationCapability {
  readonly status$: Observable<SupportStatus<SystemAuthentication>>;

  constructor(biometricsService: BiometricsService) {
    super();
    const service: SystemAuthentication = {
      verifyUser: () => biometricsService.authenticateWithBiometrics(),
    };
    this.status$ = defer(() => from(biometricsService.getBiometricsStatus())).pipe(
      map((status) => toSystemAuthenticationStatus(status, service)),
    );
  }
}
