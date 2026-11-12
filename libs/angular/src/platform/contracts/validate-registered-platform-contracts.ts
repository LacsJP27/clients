import { Injector } from "@angular/core";

import { SecureStorageCapability } from "@bitwarden/common/platform/capabilities/secure-storage.capability";
import { validatePlatformContracts } from "@bitwarden/common/platform/capabilities/validate-platform-contracts";
import { VaultStorage } from "@bitwarden/storage-core";

/**
 * Checks, when an Angular client starts, that its provider module registered the platform
 * contracts every client must provide (ADR-0001). Each client registers its own implementations;
 * the contracts with an implementation shared by all Angular clients cannot be missing and are
 * not checked here.
 */
export function validateRegisteredPlatformContracts(client: string, injector: Injector): void {
  validatePlatformContracts(client, {
    VaultStorage: injector.get(VaultStorage, null),
    SecureStorageCapability: injector.get(SecureStorageCapability, null),
  });
}
