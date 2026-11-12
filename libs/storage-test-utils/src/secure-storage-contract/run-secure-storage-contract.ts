import {
  SecureStorage,
  SecureStorageError,
  SecureStorageErrorCode,
  isSecureStorageError,
} from "@bitwarden/storage-core";

import { assertDeepEqual, assertRejectsWithCode, assertTrue } from "../contract-testing/assertions";
import { ContractTestApi, globalTestApi } from "../contract-testing/test-api";

/**
 * Failure scenarios the suite can exercise when an implementation provides a hook for them.
 * Each hook arms a one-shot failure: the next matching operation on `key` must reject with the
 * listed code and leave the stored value unchanged; later operations behave normally again.
 */
export type SecureStorageFailureScenario =
  /** next `save(key, …)` → `UNAVAILABLE` */
  | "unavailableOnSave"
  /** next `remove(key)` → `UNAVAILABLE` */
  | "unavailableOnRemove"
  /** next `get(key)` → `UNAVAILABLE` */
  | "unavailableOnGet"
  /** next `has(key)` → `UNAVAILABLE` */
  | "unavailableOnHas"
  /** next `get(key)` → `ACCESS_DENIED`; `key` already holds a value when the hook runs */
  | "accessDeniedOnGet"
  /** next `get(key)` → `CORRUPT_DATA`; `key` already holds a value when the hook runs */
  | "corruptDataOnGet";

export type SecureStorageFailureHook<S extends SecureStorage> = (
  storage: S,
  key: string,
) => void | Promise<void>;

export interface SecureStorageContractOptions<S extends SecureStorage> {
  /** Runs after each test with that test's instance. */
  cleanup?: (storage: S) => void | Promise<void>;
  /** Failure hooks; tests for scenarios without a hook are skipped, not failed. */
  simulateFailure?: Partial<Record<SecureStorageFailureScenario, SecureStorageFailureHook<S>>>;
  /**
   * Set when the implementation accepts only Base64 text and rejects anything else with
   * `INVALID_VALUE`. The round-trip cases for other text are then replaced by that rejection.
   */
  base64ValuesOnly?: boolean;
  /** Test runner functions. Defaults to the runner's globals. */
  testApi?: ContractTestApi;
}

const KEY = "contract-key";
const OTHER_KEY = "contract-other-key";
/** Distinctive, so a leak into an error message is detectable. */
const SECRET = "c2VjcmV0LWNvbnRyYWN0LXZhbHVl";
const OTHER_SECRET = "b3RoZXItY29udHJhY3QtdmFsdWU=";

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const errorType = {
  name: "SecureStorageError",
  is: (error: unknown): error is SecureStorageError => isSecureStorageError(error),
};

/**
 * Registers the shared `SecureStorage` behavioral suite (ADR-0001) for one implementation.
 * Call it at the top level of a spec file.
 *
 * @param name Shown in test output, e.g. "InMemorySecureStorage".
 * @param createStorage Returns a fresh, empty instance; called once per test.
 */
export function runSecureStorageContract<S extends SecureStorage>(
  name: string,
  createStorage: () => S | Promise<S>,
  options: SecureStorageContractOptions<S> = {},
): void {
  const { describe, it, beforeEach, afterEach } =
    options.testApi ?? globalTestApi("runSecureStorageContract");

  let storage: S;

  async function rejects(
    operation: () => Promise<unknown>,
    code: SecureStorageErrorCode,
    message: string,
  ): Promise<void> {
    const error = await assertRejectsWithCode(errorType, operation, code, message);
    assertTrue(
      !error.message.includes(SECRET) && !error.message.includes(KEY),
      `${message}: the error message contains the key or the stored value`,
    );
  }

  function withHook(
    scenario: SecureStorageFailureScenario,
    title: string,
    body: (hook: SecureStorageFailureHook<S>) => Promise<void>,
  ) {
    const hook = options.simulateFailure?.[scenario];
    if (hook === undefined) {
      it.skip(`${title} [needs simulateFailure.${scenario}]`, () => {});
    } else {
      it(title, () => body(hook));
    }
  }

  describe(`SecureStorage contract: ${name}`, () => {
    beforeEach(async () => {
      storage = await createStorage();
    });

    afterEach(async () => {
      await options.cleanup?.(storage);
    });

    describe("save and read", () => {
      it("resolves null for a key that was never saved", async () => {
        assertDeepEqual(await storage.get(KEY), null, "get");
        assertDeepEqual(await storage.has(KEY), false, "has");
      });

      it("returns a saved value unchanged", async () => {
        await storage.save(KEY, SECRET);
        assertDeepEqual(await storage.get(KEY), SECRET, "get");
        assertDeepEqual(await storage.has(KEY), true, "has");
      });

      const values: Array<[string, string]> = [
        ["text that looks like JSON", '{"a":1}'],
        ["text with quotes and backslashes", 'a"b\\c'],
        ["non-ASCII text", "clé-ключ-鍵"],
        ["a long value", "k".repeat(4096)],
      ];
      for (const [label, value] of values) {
        if (options.base64ValuesOnly && !BASE64.test(value)) {
          it(`rejects ${label} with INVALID_VALUE because it is not Base64`, async () => {
            await rejects(
              () => storage.save(KEY, value),
              SecureStorageErrorCode.InvalidValue,
              "save",
            );
            assertDeepEqual(await storage.get(KEY), null, "get after rejected save");
          });
          continue;
        }
        it(`round-trips ${label}`, async () => {
          await storage.save(KEY, value);
          assertDeepEqual(await storage.get(KEY), value, "get");
        });
      }

      it("overwrites an existing value", async () => {
        await storage.save(KEY, SECRET);
        await storage.save(KEY, OTHER_SECRET);
        assertDeepEqual(await storage.get(KEY), OTHER_SECRET, "get");
      });

      it("keeps keys independent", async () => {
        await storage.save(KEY, SECRET);
        await storage.save(OTHER_KEY, OTHER_SECRET);
        assertDeepEqual(await storage.get(KEY), SECRET, "get first key");
        assertDeepEqual(await storage.get(OTHER_KEY), OTHER_SECRET, "get second key");
      });
    });

    describe("remove", () => {
      it("deletes the key", async () => {
        await storage.save(KEY, SECRET);
        await storage.remove(KEY);
        assertDeepEqual(await storage.get(KEY), null, "get");
        assertDeepEqual(await storage.has(KEY), false, "has");
      });

      it("resolves for a key that does not exist", async () => {
        await storage.remove(KEY);
        assertDeepEqual(await storage.get(KEY), null, "get");
      });

      it("leaves other keys alone", async () => {
        await storage.save(KEY, SECRET);
        await storage.save(OTHER_KEY, OTHER_SECRET);
        await storage.remove(KEY);
        assertDeepEqual(await storage.get(OTHER_KEY), OTHER_SECRET, "get other key");
      });

      it("allows the key to be saved again", async () => {
        await storage.save(KEY, SECRET);
        await storage.remove(KEY);
        await storage.save(KEY, OTHER_SECRET);
        assertDeepEqual(await storage.get(KEY), OTHER_SECRET, "get");
      });
    });

    describe("errors", () => {
      const invalidKeys: Array<[string, unknown]> = [
        ["an empty string", ""],
        ["a number", 7],
        ["null", null],
        ["undefined", undefined],
      ];
      for (const [label, key] of invalidKeys) {
        it(`rejects ${label} as a key with INVALID_KEY on every operation`, async () => {
          const badKey = key as string;
          await rejects(() => storage.get(badKey), SecureStorageErrorCode.InvalidKey, "get");
          await rejects(() => storage.has(badKey), SecureStorageErrorCode.InvalidKey, "has");
          await rejects(
            () => storage.save(badKey, SECRET),
            SecureStorageErrorCode.InvalidKey,
            "save",
          );
          await rejects(() => storage.remove(badKey), SecureStorageErrorCode.InvalidKey, "remove");
        });
      }

      const invalidValues: Array<[string, unknown]> = [
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
        ["a number", 7],
        ["an object", { key: SECRET }],
      ];
      for (const [label, value] of invalidValues) {
        it(`rejects ${label} as a value with INVALID_VALUE and keeps the stored value`, async () => {
          await storage.save(KEY, SECRET);
          await rejects(
            () => storage.save(KEY, value as string),
            SecureStorageErrorCode.InvalidValue,
            "save",
          );
          assertDeepEqual(await storage.get(KEY), SECRET, "get after rejected save");
        });
      }

      withHook(
        "unavailableOnSave",
        "rejects a save with UNAVAILABLE, changes nothing, and recovers",
        async (hook) => {
          await storage.save(KEY, SECRET);
          await hook(storage, KEY);
          await rejects(
            () => storage.save(KEY, OTHER_SECRET),
            SecureStorageErrorCode.Unavailable,
            "save",
          );
          assertDeepEqual(await storage.get(KEY), SECRET, "get after failed save");
          await storage.save(KEY, OTHER_SECRET);
          assertDeepEqual(await storage.get(KEY), OTHER_SECRET, "get after a later save");
        },
      );

      withHook(
        "unavailableOnRemove",
        "rejects a remove with UNAVAILABLE, changes nothing, and recovers",
        async (hook) => {
          await storage.save(KEY, SECRET);
          await hook(storage, KEY);
          await rejects(() => storage.remove(KEY), SecureStorageErrorCode.Unavailable, "remove");
          assertDeepEqual(await storage.get(KEY), SECRET, "get after failed remove");
          await storage.remove(KEY);
          assertDeepEqual(await storage.get(KEY), null, "get after a later remove");
        },
      );

      withHook(
        "unavailableOnGet",
        "rejects a get with UNAVAILABLE instead of resolving null",
        async (hook) => {
          await storage.save(KEY, SECRET);
          await hook(storage, KEY);
          await rejects(() => storage.get(KEY), SecureStorageErrorCode.Unavailable, "get");
          assertDeepEqual(await storage.get(KEY), SECRET, "get after the failure");
        },
      );

      withHook(
        "unavailableOnHas",
        "rejects has with UNAVAILABLE instead of resolving false",
        async (hook) => {
          await storage.save(KEY, SECRET);
          await hook(storage, KEY);
          await rejects(() => storage.has(KEY), SecureStorageErrorCode.Unavailable, "has");
          assertDeepEqual(await storage.has(KEY), true, "has after the failure");
        },
      );

      withHook(
        "accessDeniedOnGet",
        "rejects a refused read with ACCESS_DENIED instead of resolving null",
        async (hook) => {
          await storage.save(KEY, SECRET);
          await hook(storage, KEY);
          await rejects(() => storage.get(KEY), SecureStorageErrorCode.AccessDenied, "get");
        },
      );

      withHook(
        "corruptDataOnGet",
        "rejects unreadable stored data with CORRUPT_DATA instead of resolving null",
        async (hook) => {
          await storage.save(KEY, SECRET);
          await hook(storage, KEY);
          await rejects(() => storage.get(KEY), SecureStorageErrorCode.CorruptData, "get");
        },
      );
    });
  });
}
