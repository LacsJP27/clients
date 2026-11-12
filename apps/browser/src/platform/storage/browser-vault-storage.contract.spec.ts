import { mock } from "jest-mock-extended";

import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { runVaultStorageContract } from "@bitwarden/storage-test-utils";

import BrowserLocalStorageService from "../services/browser-local-storage.service";

import { BrowserVaultStorage } from "./browser-vault-storage";

type AreaOperation = "get" | "set" | "remove";

/** A double of the extension storage area: asynchronous callbacks, failures via `lastError`. */
class FakeStorageArea {
  readonly data: Record<string, unknown> = {};
  readonly onChanged = { addListener: jest.fn(), removeListener: jest.fn() };
  private readonly armed = new Map<AreaOperation, { message: string }>();

  failNext(operation: AreaOperation, message: string): void {
    this.armed.set(operation, { message });
  }

  get(key: string, callback: (items: Record<string, unknown>) => void): void {
    const failure = this.take("get");
    if (failure !== undefined) {
      // What the API does once the extension context is gone.
      throw new Error(failure.message);
    }
    queueMicrotask(() => callback(key in this.data ? { [key]: this.data[key] } : {}));
  }

  set(items: Record<string, unknown>, callback: () => void): void {
    this.respond("set", callback, () => Object.assign(this.data, items));
  }

  remove(key: string, callback: () => void): void {
    this.respond("remove", callback, () => delete this.data[key]);
  }

  private respond(operation: AreaOperation, callback: () => void, apply: () => void): void {
    queueMicrotask(() => {
      const failure = this.take(operation);
      if (failure === undefined) {
        apply();
        callback();
        return;
      }
      (chrome.runtime as { lastError?: unknown }).lastError = failure;
      callback();
      delete (chrome.runtime as { lastError?: unknown }).lastError;
    });
  }

  private take(operation: AreaOperation) {
    const failure = this.armed.get(operation);
    this.armed.delete(operation);
    return failure;
  }
}

let area: FakeStorageArea;

function create(): BrowserVaultStorage {
  area = new FakeStorageArea();
  (chrome.storage as { local: unknown }).local = area;
  return new BrowserVaultStorage(new BrowserLocalStorageService(mock<LogService>()));
}

runVaultStorageContract("BrowserVaultStorage", create, {
  simulateFailure: {
    quotaExceededOnSave: () => area.failNext("set", "QUOTA_BYTES quota exceeded"),
    unavailableOnSave: () => area.failNext("set", "IO error"),
    unavailableOnRemove: () => area.failNext("remove", "IO error"),
    unavailableOnGet: () => area.failNext("get", "Extension context invalidated."),
    unavailableOnHas: () => area.failNext("get", "Extension context invalidated."),
    corruptDataOnGet: (_storage, key) => {
      area.data[key] = { __json__: true, value: "{not json" };
    },
  },
});

describe("BrowserVaultStorage and existing data", () => {
  it("reads values in the current wrapped format and in the legacy unwrapped format", async () => {
    const storage = create();
    area.data.wrapped = { __json__: true, value: JSON.stringify({ a: 1 }) };
    area.data.legacy = { b: 2 };

    await expect(storage.get("wrapped")).resolves.toEqual({ a: 1 });
    await expect(storage.get("legacy")).resolves.toEqual({ b: 2 });
  });

  it("writes the format the extension already uses", async () => {
    const storage = create();

    await storage.save("key", { a: 1 });

    expect(area.data.key).toEqual({ __json__: true, value: JSON.stringify({ a: 1 }) });
  });
});
