import { InMemorySecureStorage, SecureStorageErrorCode } from "@bitwarden/storage-core";

import { runSecureStorageContract } from "./run-secure-storage-contract";

runSecureStorageContract("InMemorySecureStorage", () => new InMemorySecureStorage(), {
  simulateFailure: {
    unavailableOnSave: (storage, key) =>
      storage.failNext("save", SecureStorageErrorCode.Unavailable, key),
    unavailableOnRemove: (storage, key) =>
      storage.failNext("remove", SecureStorageErrorCode.Unavailable, key),
    unavailableOnGet: (storage, key) =>
      storage.failNext("get", SecureStorageErrorCode.Unavailable, key),
    unavailableOnHas: (storage, key) =>
      storage.failNext("has", SecureStorageErrorCode.Unavailable, key),
    accessDeniedOnGet: (storage, key) =>
      storage.failNext("get", SecureStorageErrorCode.AccessDenied, key),
    corruptDataOnGet: (storage, key) =>
      storage.failNext("get", SecureStorageErrorCode.CorruptData, key),
  },
});
