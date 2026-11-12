import { Observable, defer, of } from "rxjs";

import { SupportStatus } from "../misc/support-status";
import { SystemNotificationsService } from "../system-notifications/system-notifications.service";

import { CapabilityStatus, PlatformCapability } from "./platform-capability";

/** Documented reasons a client reports for system notifications that are not ready to use. */
export const SystemNotificationsStatusReason = Object.freeze({
  /** The client cannot show operating-system notifications. */
  NoSystemNotifications: "no-system-notifications",
} as const);

export type SystemNotificationsStatusReason =
  (typeof SystemNotificationsStatusReason)[keyof typeof SystemNotificationsStatusReason];

/** The system notifications capability and its runtime token. */
export abstract class SystemNotificationsCapability extends PlatformCapability<SystemNotificationsService> {}

/**
 * Reports the capability from the notifications service a client already registers, so feature
 * code reads a status instead of guarding every call with `isSupported()` or catching the
 * unsupported implementation's errors.
 */
export class DefaultSystemNotificationsCapability extends SystemNotificationsCapability {
  readonly status$: Observable<SupportStatus<SystemNotificationsService>>;

  constructor(service: SystemNotificationsService) {
    super();
    this.status$ = defer(() =>
      of(
        service.isSupported()
          ? CapabilityStatus.supported(service)
          : CapabilityStatus.notSupported(SystemNotificationsStatusReason.NoSystemNotifications),
      ),
    );
  }
}
