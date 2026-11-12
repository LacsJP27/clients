import { firstValueFrom, of } from "rxjs";

import { InMemorySecureStorage, SecureStorage } from "@bitwarden/storage-core";

import { SupportStatus, supportSwitch } from "../misc/support-status";
import { SystemNotificationsService } from "../system-notifications/system-notifications.service";
import { UnsupportedSystemNotificationsService } from "../system-notifications/unsupported-system-notifications.service";

import { CapabilityStatus } from "./platform-capability";
import {
  SecureStorageCapability,
  SecureStorageStatusReason,
  UnsupportedSecureStorageCapability,
} from "./secure-storage.capability";
import { DefaultSystemNotificationsCapability } from "./system-notifications.capability";
import {
  MissingPlatformContractError,
  validatePlatformContracts,
} from "./validate-platform-contracts";

describe("capability status", () => {
  const storage = new InMemorySecureStorage();
  const states: Array<[SupportStatus<SecureStorage>, string]> = [
    [CapabilityStatus.supported(storage), "ready"],
    [CapabilityStatus.needsConfiguration("grant-permission"), "grant-permission"],
    [CapabilityStatus.unavailable("device-disconnected"), "device-disconnected"],
    [CapabilityStatus.notSupported("no-protected-storage"), "no-protected-storage"],
  ];

  it.each(states)("routes %j so only a ready capability is invoked", async (status, expected) => {
    const result = await firstValueFrom(
      of(status).pipe(
        supportSwitch({
          supported: (service) => of(service === storage ? "ready" : "wrong service"),
          notSupported: (reason) => of(reason),
        }),
      ),
    );

    expect(result).toBe(expected);
  });

  it("keeps the four states distinguishable", () => {
    expect(states.map(([status]) => status.type)).toEqual([
      "supported",
      "needs-configuration",
      "unavailable",
      "not-supported",
    ]);
  });
});

describe("UnsupportedSecureStorageCapability", () => {
  it("reports that the platform has no protected storage, without throwing", async () => {
    const capability: SecureStorageCapability = new UnsupportedSecureStorageCapability();

    await expect(firstValueFrom(capability.status$)).resolves.toEqual({
      type: "not-supported",
      reason: SecureStorageStatusReason.NoProtectedStorage,
    });
  });
});

describe("DefaultSystemNotificationsCapability", () => {
  it("offers the service when the client supports notifications", async () => {
    const service = { isSupported: () => true } as SystemNotificationsService;

    const status = await firstValueFrom(new DefaultSystemNotificationsCapability(service).status$);

    expect(status).toEqual({ type: "supported", service });
  });

  it("reports not-supported for the unsupported implementation instead of exposing it", async () => {
    const capability = new DefaultSystemNotificationsCapability(
      new UnsupportedSystemNotificationsService(),
    );

    await expect(firstValueFrom(capability.status$)).resolves.toEqual({
      type: "not-supported",
      reason: "no-system-notifications",
    });
  });
});

describe("validatePlatformContracts", () => {
  it("accepts a client that registered every contract", () => {
    expect(() =>
      validatePlatformContracts("test", { VaultStorage: {}, SecureStorageCapability: {} }),
    ).not.toThrow();
  });

  it("names the client and every missing contract", () => {
    const validate = () =>
      validatePlatformContracts("desktop", {
        VaultStorage: undefined,
        SecureStorageCapability: {},
        SystemNotificationsCapability: null,
      });

    expect(validate).toThrow(MissingPlatformContractError);
    expect(validate).toThrow(
      "The desktop client did not register: VaultStorage, SystemNotificationsCapability",
    );
  });
});
