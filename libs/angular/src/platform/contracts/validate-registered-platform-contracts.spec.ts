import { Injector } from "@angular/core";

import {
  SecureStorageCapability,
  UnsupportedSecureStorageCapability,
} from "@bitwarden/common/platform/capabilities/secure-storage.capability";
import { MissingPlatformContractError } from "@bitwarden/common/platform/capabilities/validate-platform-contracts";
import { InMemoryVaultStorage, VaultStorage } from "@bitwarden/storage-core";

import { validateRegisteredPlatformContracts } from "./validate-registered-platform-contracts";

describe("validateRegisteredPlatformContracts", () => {
  const vaultStorage = { provide: VaultStorage, useValue: new InMemoryVaultStorage() };
  const secureStorage = {
    provide: SecureStorageCapability,
    useValue: new UnsupportedSecureStorageCapability(),
  };

  it("accepts a client that registered both storage contracts", () => {
    const injector = Injector.create({ providers: [vaultStorage, secureStorage] });

    expect(() => validateRegisteredPlatformContracts("web", injector)).not.toThrow();
  });

  it("stops startup, naming the contract, when a client registered no vault storage", () => {
    const injector = Injector.create({ providers: [secureStorage] });

    const validate = () => validateRegisteredPlatformContracts("web", injector);

    expect(validate).toThrow(MissingPlatformContractError);
    expect(validate).toThrow("The web client did not register: VaultStorage");
  });

  it("resolves whichever implementation the client registered", () => {
    const injector = Injector.create({ providers: [vaultStorage, secureStorage] });

    expect(injector.get(VaultStorage)).toBe(vaultStorage.useValue);
  });
});
