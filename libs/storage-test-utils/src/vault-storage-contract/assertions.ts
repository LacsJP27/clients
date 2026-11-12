import {
  VaultStorageError,
  VaultStorageErrorCode,
  isVaultStorageError,
} from "@bitwarden/storage-core";

import { assertRejectsWithCode } from "../contract-testing/assertions";

export {
  ContractAssertionError,
  assertDeepEqual,
  assertTrue,
  awaitAll,
  fail,
} from "../contract-testing/assertions";

/**
 * Calls `operation` and asserts that it returns a promise that rejects with a `VaultStorageError`
 * carrying `code`, without throwing synchronously.
 */
export async function assertRejectsWith(
  operation: () => Promise<unknown>,
  code: VaultStorageErrorCode,
  message: string,
): Promise<void> {
  await assertRejectsWithCode<VaultStorageError>(
    {
      name: "VaultStorageError",
      is: (error): error is VaultStorageError => isVaultStorageError(error),
    },
    operation,
    code,
    message,
  );
}
