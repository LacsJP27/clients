import { mock } from "jest-mock-extended";
import { firstValueFrom } from "rxjs";

import { BiometricsService } from "./biometric.service";
import { BiometricsStatus } from "./biometrics-status";
import {
  DefaultSystemAuthenticationCapability,
  SystemAuthentication,
  toSystemAuthenticationStatus,
} from "./system-authentication.capability";

describe("toSystemAuthenticationStatus", () => {
  const service: SystemAuthentication = { verifyUser: async () => true };

  const expected: Array<[BiometricsStatus, string, string | undefined]> = [
    [BiometricsStatus.Available, "supported", undefined],
    [BiometricsStatus.UnlockNeeded, "unavailable", "unlock-needed"],
    [BiometricsStatus.HardwareUnavailable, "unavailable", "hardware-unavailable"],
    [BiometricsStatus.DesktopDisconnected, "unavailable", "desktop-disconnected"],
    [BiometricsStatus.AutoSetupNeeded, "needs-configuration", "auto-setup-needed"],
    [BiometricsStatus.ManualSetupNeeded, "needs-configuration", "manual-setup-needed"],
    [BiometricsStatus.NotEnabledLocally, "needs-configuration", "not-enabled-locally"],
    [
      BiometricsStatus.NotEnabledInConnectedDesktopApp,
      "needs-configuration",
      "not-enabled-in-connected-desktop-app",
    ],
    [
      BiometricsStatus.NativeMessagingPermissionMissing,
      "needs-configuration",
      "native-messaging-permission-missing",
    ],
    [BiometricsStatus.PlatformUnsupported, "not-supported", "platform-unsupported"],
  ];

  it.each(expected)("maps status %s to %s", (status, type, reason) => {
    const result = toSystemAuthenticationStatus(status, service);

    expect(result.type).toBe(type);
    expect("reason" in result ? result.reason : undefined).toBe(reason);
  });

  it("covers every biometrics status", () => {
    const all = Object.values(BiometricsStatus).filter((value) => typeof value === "number");

    expect(expected.map(([status]) => status).sort()).toEqual(all.sort());
  });

  it("treats an unknown status as not supported", () => {
    expect(toSystemAuthenticationStatus(999 as BiometricsStatus, service).type).toBe(
      "not-supported",
    );
  });
});

describe("DefaultSystemAuthenticationCapability", () => {
  it("offers user verification through the registered biometrics service when ready", async () => {
    const biometrics = mock<BiometricsService>();
    biometrics.getBiometricsStatus.mockResolvedValue(BiometricsStatus.Available);
    biometrics.authenticateWithBiometrics.mockResolvedValue(true);

    const status = await firstValueFrom(
      new DefaultSystemAuthenticationCapability(biometrics).status$,
    );

    expect(status.type).toBe("supported");
    await expect(status.type === "supported" && status.service.verifyUser()).resolves.toBe(true);
  });

  it("reads the status again for each subscriber", async () => {
    const biometrics = mock<BiometricsService>();
    biometrics.getBiometricsStatus
      .mockResolvedValueOnce(BiometricsStatus.HardwareUnavailable)
      .mockResolvedValueOnce(BiometricsStatus.Available);
    const capability = new DefaultSystemAuthenticationCapability(biometrics);

    expect((await firstValueFrom(capability.status$)).type).toBe("unavailable");
    expect((await firstValueFrom(capability.status$)).type).toBe("supported");
  });
});
