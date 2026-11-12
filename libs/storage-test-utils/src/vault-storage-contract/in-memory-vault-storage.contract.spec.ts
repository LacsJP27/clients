import {
  InMemoryVaultStorage,
  VaultStorageError,
  VaultStorageErrorCode,
} from "@bitwarden/storage-core";

import { runVaultStorageContract } from "./run-vault-storage-contract";

runVaultStorageContract("InMemoryVaultStorage", () => new InMemoryVaultStorage(), {
  simulateFailure: {
    quotaExceededOnSave: (storage, key) =>
      storage.failNext("save", VaultStorageErrorCode.QuotaExceeded, key),
    unavailableOnSave: (storage, key) =>
      storage.failNext("save", VaultStorageErrorCode.Unavailable, key),
    unavailableOnRemove: (storage, key) =>
      storage.failNext("remove", VaultStorageErrorCode.Unavailable, key),
    unavailableOnGet: (storage, key) =>
      storage.failNext("get", VaultStorageErrorCode.Unavailable, key),
    unavailableOnHas: (storage, key) =>
      storage.failNext("has", VaultStorageErrorCode.Unavailable, key),
    corruptDataOnGet: (storage, key) =>
      storage.failNext("get", VaultStorageErrorCode.CorruptData, key),
  },
});

describe("InMemoryVaultStorage quota", () => {
  it("rejects a save that would exceed the quota and keeps existing data", async () => {
    // "a" + JSON "\"xxxx\"" = 1 + 6 = 7 units per entry.
    const storage = new InMemoryVaultStorage({ quota: 14 });
    await storage.save("a", "xxxx");
    await storage.save("b", "xxxx");

    await expect(storage.save("c", "xxxx")).rejects.toEqual(
      new VaultStorageError(VaultStorageErrorCode.QuotaExceeded),
    );
    await expect(storage.get("c")).resolves.toBeNull();
    await expect(storage.get("a")).resolves.toBe("xxxx");
  });

  it("counts a replaced value once, so overwriting at the limit succeeds", async () => {
    const storage = new InMemoryVaultStorage({ quota: 7 });
    await storage.save("a", "xxxx");

    await storage.save("a", "yyyy");

    await expect(storage.get("a")).resolves.toBe("yyyy");
  });

  it("frees space when a key is removed", async () => {
    const storage = new InMemoryVaultStorage({ quota: 7 });
    await storage.save("a", "xxxx");
    await storage.remove("a");

    await storage.save("b", "xxxx");

    await expect(storage.get("b")).resolves.toBe("xxxx");
  });
});
