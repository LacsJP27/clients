import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { mock } from "jest-mock-extended";

import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { runVaultStorageContract } from "@bitwarden/storage-test-utils";

import { CliVaultStorage } from "./cli-vault-storage";
import { LowdbStorageService } from "./lowdb-storage.service";

const directories: string[] = [];
const services = new WeakMap<CliVaultStorage, LowdbStorageService>();

function openService(dir: string): LowdbStorageService {
  return new LowdbStorageService(mock<LogService>(), null, dir, false, true);
}

/** Each instance gets a real data file in its own temporary directory. */
function create(): CliVaultStorage {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-vault-storage-"));
  directories.push(dir);
  const service = openService(dir);
  const storage = new CliVaultStorage(service);
  services.set(storage, service);
  return storage;
}

const fileError = (code: string) => Object.assign(new Error("data file failure"), { code });
function failNext(storage: CliVaultStorage, method: "get" | "save" | "remove", code: string): void {
  jest.spyOn(services.get(storage)!, method).mockRejectedValueOnce(fileError(code));
}

afterEach(() => {
  jest.restoreAllMocks();
  directories.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

// The service recovers from an undecodable data file by itself when it opens it, so a value that
// cannot be decoded never reaches the adapter.
runVaultStorageContract("CliVaultStorage", create, {
  simulateFailure: {
    quotaExceededOnSave: (storage) => failNext(storage, "save", "ENOSPC"),
    unavailableOnSave: (storage) => failNext(storage, "save", "EIO"),
    unavailableOnRemove: (storage) => failNext(storage, "remove", "EIO"),
    unavailableOnGet: (storage) => failNext(storage, "get", "EIO"),
    unavailableOnHas: (storage) => failNext(storage, "get", "EIO"),
  },
});

describe("CliVaultStorage and the data file", () => {
  it("keeps values across a restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-vault-storage-"));
    directories.push(dir);
    await new CliVaultStorage(openService(dir)).save("key", { a: 1 });

    const reopened = new CliVaultStorage(openService(dir));

    await expect(reopened.get("key")).resolves.toEqual({ a: 1 });
  });

  it("reads data written by the existing service and keeps its file format", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-vault-storage-"));
    directories.push(dir);
    await openService(dir).save("existing", { a: 1 });
    const storage = new CliVaultStorage(openService(dir));

    await expect(storage.get("existing")).resolves.toEqual({ a: 1 });
    await storage.save("key", { b: 2 });

    const file = JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8"));
    expect(file).toEqual({ existing: { a: 1 }, key: { b: 2 } });
  });
});
