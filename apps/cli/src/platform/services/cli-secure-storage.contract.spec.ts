import { mock } from "jest-mock-extended";
import { firstValueFrom } from "rxjs";

import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
// eslint-disable-next-line no-restricted-imports
import { EncArrayBuffer, EncryptService, SymmetricCryptoKey } from "@bitwarden/legacy-crypto";
import { MemoryStorageService } from "@bitwarden/storage-core";
import { runSecureStorageContract } from "@bitwarden/storage-test-utils";

import { CliSecureStorage, CliSecureStorageCapability } from "./cli-secure-storage.capability";
import {
  NodeEnvSecureStorageService,
  PROTECTED_STORAGE_KEY_PREFIX,
} from "./node-env-secure-storage.service";

const sessionKey = (fill: number) => Utils.fromBufferToB64(new Uint8Array(64).fill(fill));
const hasSessionKey = () => process.env.BW_SESSION != null;

const HEADER_LENGTH = 1 + 16 + 32;
const AES_CBC_HMAC = 2;

/**
 * A double of the encryption the service delegates to. It only has to be reversible with the same
 * key and fail with another one, which is what the real one does; it protects nothing.
 */
function fakeEncryptService(): EncryptService {
  const encryptService = mock<EncryptService>();
  encryptService.encryptFileData.mockImplementation(async (plain, key: SymmetricCryptoKey) => {
    const buffer = new Uint8Array(HEADER_LENGTH + plain.length);
    buffer[0] = AES_CBC_HMAC;
    buffer.set(key.toEncoded().slice(0, 16), 1);
    buffer.set(
      plain.map((byte) => byte ^ 0xaa),
      HEADER_LENGTH,
    );
    return new EncArrayBuffer(buffer);
  });
  encryptService.decryptFileData.mockImplementation(async (encrypted, key: SymmetricCryptoKey) => {
    const buffer = encrypted.buffer;
    const sameKey = key
      .toEncoded()
      .slice(0, 16)
      .every((byte, index) => buffer[1 + index] === byte);
    if (!sameKey) {
      throw new Error("MAC comparison failed");
    }
    return buffer.slice(HEADER_LENGTH).map((byte) => byte ^ 0xaa);
  });
  return encryptService;
}

let disk: MemoryStorageService;

/** The existing session-protected service over in-memory ordinary storage, with a session present. */
function create(): CliSecureStorage {
  process.env.BW_SESSION = sessionKey(1);
  disk = new MemoryStorageService();
  const protectedStorage = new NodeEnvSecureStorageService(
    disk,
    mock<LogService>(),
    fakeEncryptService(),
  );
  return new CliSecureStorage(
    protectedStorage,
    (key) => disk.has(PROTECTED_STORAGE_KEY_PREFIX + key),
    hasSessionKey,
  );
}

function failNext(method: "get" | "save" | "remove"): void {
  jest.spyOn(disk, method).mockRejectedValueOnce(new Error("data file failure"));
}

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.BW_SESSION;
});

runSecureStorageContract("CliSecureStorage", create, {
  base64ValuesOnly: true,
  simulateFailure: {
    unavailableOnSave: () => failNext("save"),
    unavailableOnRemove: () => failNext("remove"),
    unavailableOnGet: () => failNext("get"),
    unavailableOnHas: () => failNext("get"),
    // A session other than the one the value was stored under.
    accessDeniedOnGet: () => void (process.env.BW_SESSION = sessionKey(2)),
  },
});

describe("CliSecureStorage and the session key", () => {
  const value = Utils.fromBufferToB64(new Uint8Array(32).fill(7));

  it("refuses to save without a session key instead of storing an unprotected value", async () => {
    const storage = create();
    delete process.env.BW_SESSION;

    await expect(storage.save("key", value)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(disk.has(PROTECTED_STORAGE_KEY_PREFIX + "key")).resolves.toBe(false);
  });

  it("stores the value protected, not as given", async () => {
    const storage = create();

    await storage.save("key", value);

    const stored = await disk.get<string>(PROTECTED_STORAGE_KEY_PREFIX + "key");
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(value);
  });
});

describe("CliSecureStorageCapability", () => {
  it("is ready while a session key is present and needs one otherwise", async () => {
    const capability = new CliSecureStorageCapability(create(), hasSessionKey);

    expect((await firstValueFrom(capability.status$)).type).toBe("supported");

    delete process.env.BW_SESSION;

    await expect(firstValueFrom(capability.status$)).resolves.toEqual({
      type: "needs-configuration",
      reason: "protecting-key-required",
    });
  });
});
