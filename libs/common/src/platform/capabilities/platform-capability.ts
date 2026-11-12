import { Observable } from "rxjs";

import {
  NeedsConfiguration,
  NotSupported,
  SupportStatus,
  Supported,
  Unavailable,
} from "../misc/support-status";

/**
 * A platform capability that a client may or may not offer (ADR-0001, component 4).
 *
 * Feature code never receives the capability's service directly. It reads {@link status$} and gets
 * the service only from a `supported` status, so a capability a client lacks is a value to branch
 * on rather than a method that throws. The four states are:
 *
 * - `supported`: ready to use; carries the service.
 * - `needs-configuration`: would work after the user grants a permission or changes a setting.
 * - `unavailable`: works on this client but not right now; may recover without the user.
 * - `not-supported`: does not exist on this client.
 *
 * Each capability declares a subclass, which serves as its runtime token, and each client
 * registers its own implementation of that subclass during bootstrap.
 */
export abstract class PlatformCapability<TService> {
  /** The capability's current status. Emits on subscription and again whenever it changes. */
  abstract readonly status$: Observable<SupportStatus<TService>>;
}

/** Constructors for the four capability states, so adapters report them uniformly. */
export const CapabilityStatus = Object.freeze({
  supported: <TService>(service: TService): Supported<TService> => ({
    type: "supported",
    service,
  }),
  needsConfiguration: (reason: string): NeedsConfiguration => ({
    type: "needs-configuration",
    reason,
  }),
  unavailable: (reason: string): Unavailable => ({ type: "unavailable", reason }),
  notSupported: (reason: string): NotSupported => ({ type: "not-supported", reason }),
});
