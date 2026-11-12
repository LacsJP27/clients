import { VaultStorage, VaultStorageErrorCode, VaultStorageUpdate } from "@bitwarden/storage-core";

import { assertDeepEqual, assertRejectsWith, assertTrue, awaitAll, fail } from "./assertions";

/**
 * Failure scenarios the suite can exercise when an implementation provides a hook for them.
 * Each hook arms a one-shot failure: the next matching operation on `key` must reject with the
 * listed code and leave stored data unchanged; later operations behave normally again.
 */
export type VaultStorageFailureScenario =
  /** next `save(key, …)` → `QUOTA_EXCEEDED` */
  | "quotaExceededOnSave"
  /** next `save(key, …)` → `UNAVAILABLE` */
  | "unavailableOnSave"
  /** next `remove(key)` → `UNAVAILABLE` */
  | "unavailableOnRemove"
  /** next `get(key)` → `UNAVAILABLE` */
  | "unavailableOnGet"
  /** next `has(key)` → `UNAVAILABLE` */
  | "unavailableOnHas"
  /** next `get(key)` → `CORRUPT_DATA`; `key` already holds a value when the hook runs */
  | "corruptDataOnGet";

export type VaultStorageFailureHook<S extends VaultStorage> = (
  storage: S,
  key: string,
) => void | Promise<void>;

type TestBody = () => void | Promise<void>;

/** The runner functions the suite needs. Jest, Vitest (globals), Mocha, and Jasmine all qualify. */
export interface ContractTestApi {
  describe(name: string, body: () => void): void;
  it: ((name: string, body: TestBody) => void) & { skip(name: string, body: TestBody): void };
  beforeEach(body: TestBody): void;
  afterEach(body: TestBody): void;
}

export interface VaultStorageContractOptions<S extends VaultStorage> {
  /** Runs after each test with that test's instance (close handles, delete temp profiles, …). */
  cleanup?: (storage: S) => void | Promise<void>;
  /** Failure hooks; tests for scenarios without a hook are skipped, not failed. */
  simulateFailure?: Partial<Record<VaultStorageFailureScenario, VaultStorageFailureHook<S>>>;
  /** Test runner functions. Defaults to the runner's globals. */
  testApi?: ContractTestApi;
}

const KEY = "contract-key";
const OTHER_KEY = "contract-other-key";

/**
 * Registers the shared `VaultStorage` behavioral suite (ADR-0001, C6) for one implementation.
 * Call it at the top level of a spec file.
 *
 * @param name Shown in test output, e.g. "InMemoryVaultStorage".
 * @param createStorage Returns a fresh, empty instance; called once per test.
 */
export function runVaultStorageContract<S extends VaultStorage>(
  name: string,
  createStorage: () => S | Promise<S>,
  options: VaultStorageContractOptions<S> = {},
): void {
  const { describe, it, beforeEach, afterEach } = options.testApi ?? globalTestApi();

  let storage: S;
  let subscriptions: Array<{ unsubscribe(): void }> = [];

  /** Subscribes to `updates$` and records every update; unsubscribed automatically after each test. */
  function recordUpdates(target: S = storage) {
    const updates: VaultStorageUpdate[] = [];
    const subscription = target.updates$.subscribe((update) => updates.push(update));
    subscriptions.push(subscription);
    return { updates, unsubscribe: () => subscription.unsubscribe() };
  }

  function withHook(
    scenario: VaultStorageFailureScenario,
    title: string,
    body: (hook: VaultStorageFailureHook<S>) => Promise<void>,
  ) {
    const hook = options.simulateFailure?.[scenario];
    if (hook === undefined) {
      it.skip(`${title} [needs simulateFailure.${scenario}]`, () => {});
    } else {
      it(title, () => body(hook));
    }
  }

  describe(`VaultStorage contract: ${name}`, () => {
    beforeEach(async () => {
      storage = await createStorage();
      subscriptions = [];
    });

    afterEach(async () => {
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      await options.cleanup?.(storage);
    });

    describe("save and read", () => {
      it("resolves null for a key that was never saved", async () => {
        assertDeepEqual(await storage.get(KEY), null, "get(missing)");
        assertDeepEqual(await storage.has(KEY), false, "has(missing)");
      });

      const values: Array<[string, unknown]> = [
        ["a string", "value"],
        ["a number", 42.5],
        ["true", true],
        ["an empty string", ""],
        ["zero", 0],
        ["false", false],
        ["an empty object", {}],
        ["an empty array", []],
        [
          "nested objects and arrays",
          { id: "1", tags: ["a", "b"], nested: { n: 1, flag: false, none: null } },
        ],
      ];
      for (const [label, value] of values) {
        it(`round-trips ${label}`, async () => {
          await storage.save(KEY, value);
          assertDeepEqual(await storage.get(KEY), value, "get after save");
          assertDeepEqual(await storage.has(KEY), true, "has after save");
        });
      }

      it("drops object properties whose value is undefined", async () => {
        await storage.save(KEY, { kept: 1, dropped: undefined });
        assertDeepEqual(await storage.get(KEY), { kept: 1 }, "get after save");
      });

      it("overwrites an existing value", async () => {
        await storage.save(KEY, { version: 1 });
        await storage.save(KEY, { version: 2 });
        assertDeepEqual(await storage.get(KEY), { version: 2 }, "get after overwrite");
      });

      it("keeps keys independent", async () => {
        await storage.save(KEY, "first");
        await storage.save(OTHER_KEY, "second");
        assertDeepEqual(await storage.get(KEY), "first", "get(KEY)");
        assertDeepEqual(await storage.get(OTHER_KEY), "second", "get(OTHER_KEY)");
      });

      it("treats saving null as remove", async () => {
        await storage.save(KEY, "value");
        await storage.save(KEY, null);
        assertDeepEqual(await storage.get(KEY), null, "get after save(null)");
        assertDeepEqual(await storage.has(KEY), false, "has after save(null)");
      });

      it("treats saving undefined as remove", async () => {
        await storage.save(KEY, "value");
        await storage.save(KEY, undefined);
        assertDeepEqual(await storage.get(KEY), null, "get after save(undefined)");
        assertDeepEqual(await storage.has(KEY), false, "has after save(undefined)");
      });
    });

    describe("isolation", () => {
      it("is unaffected by mutating a value after saving it", async () => {
        const value = { list: [1], nested: { n: 1 } };
        await storage.save(KEY, value);
        value.list.push(2);
        value.nested.n = 99;
        assertDeepEqual(
          await storage.get(KEY),
          { list: [1], nested: { n: 1 } },
          "get after mutating the saved object",
        );
      });

      it("is unaffected by mutating a value after reading it", async () => {
        await storage.save(KEY, { list: [1], nested: { n: 1 } });
        const read = await storage.get<{ list: number[]; nested: { n: number } }>(KEY);
        if (read === null) {
          fail("get after save resolved null");
        }
        read.list.push(2);
        read.nested.n = 99;
        assertDeepEqual(
          await storage.get(KEY),
          { list: [1], nested: { n: 1 } },
          "get after mutating a read result",
        );
      });

      it("is unaffected by mutating values received in a notification", async () => {
        await storage.save(KEY, { n: 1 });
        const { updates } = recordUpdates();
        await storage.save(KEY, { n: 2 });
        (updates[0].oldValue as { n: number }).n = 98;
        (updates[0].newValue as { n: number }).n = 99;
        assertDeepEqual(await storage.get(KEY), { n: 2 }, "get after mutating notification values");
      });
    });

    describe("remove", () => {
      it("deletes the key", async () => {
        await storage.save(KEY, "value");
        await storage.remove(KEY);
        assertDeepEqual(await storage.get(KEY), null, "get after remove");
        assertDeepEqual(await storage.has(KEY), false, "has after remove");
      });

      it("resolves for a key that does not exist", async () => {
        await storage.remove(KEY);
        assertDeepEqual(await storage.get(KEY), null, "get after removing a missing key");
      });

      it("leaves other keys alone", async () => {
        await storage.save(KEY, "value");
        await storage.save(OTHER_KEY, "other");
        await storage.remove(KEY);
        assertDeepEqual(await storage.get(OTHER_KEY), "other", "get(OTHER_KEY)");
      });

      it("allows the key to be saved again", async () => {
        await storage.save(KEY, "first");
        await storage.remove(KEY);
        await storage.save(KEY, "second");
        assertDeepEqual(await storage.get(KEY), "second", "get after save, remove, save");
      });
    });

    describe("change notifications", () => {
      it("reports a first save with a null old value", async () => {
        const { updates } = recordUpdates();
        await storage.save(KEY, { n: 1 });
        assertDeepEqual(
          updates,
          [{ key: KEY, updateType: "save", oldValue: null, newValue: { n: 1 } }],
          "updates",
        );
      });

      it("reports an overwrite with the old and new values", async () => {
        await storage.save(KEY, { n: 1 });
        const { updates } = recordUpdates();
        await storage.save(KEY, { n: 2 });
        assertDeepEqual(
          updates,
          [{ key: KEY, updateType: "save", oldValue: { n: 1 }, newValue: { n: 2 } }],
          "updates",
        );
      });

      it("reports a remove with the old value and a null new value", async () => {
        await storage.save(KEY, { n: 1 });
        const { updates } = recordUpdates();
        await storage.remove(KEY);
        assertDeepEqual(
          updates,
          [{ key: KEY, updateType: "remove", oldValue: { n: 1 }, newValue: null }],
          "updates",
        );
      });

      it("reports save(null) on an existing key as a remove", async () => {
        await storage.save(KEY, "value");
        const { updates } = recordUpdates();
        await storage.save(KEY, null);
        assertDeepEqual(
          updates,
          [{ key: KEY, updateType: "remove", oldValue: "value", newValue: null }],
          "updates",
        );
      });

      it("notifies before the write's promise resolves", async () => {
        const { updates } = recordUpdates();
        await storage.save(KEY, "value");
        assertTrue(
          updates.length === 1,
          `expected 1 update when save resolved, got ${updates.length}`,
        );
        await storage.remove(KEY);
        assertTrue(
          updates.length === 2,
          `expected 2 updates when remove resolved, got ${updates.length}`,
        );
      });

      it("notifies only after the change is visible to reads", async () => {
        let readFromSubscriber: Promise<unknown> | undefined;
        subscriptions.push(
          storage.updates$.subscribe(() => {
            if (readFromSubscriber === undefined) {
              readFromSubscriber = storage.get(KEY);
              // Handled below; this only keeps a failing save from leaving it unobserved.
              readFromSubscriber.catch(() => {});
            }
          }),
        );
        await storage.save(KEY, "value");
        if (readFromSubscriber === undefined) {
          fail("subscriber was not notified");
        }
        assertDeepEqual(await readFromSubscriber, "value", "get started inside the subscriber");
      });

      it("notifies every subscriber exactly once", async () => {
        const first = recordUpdates();
        const second = recordUpdates();
        await storage.save(KEY, "value");
        assertDeepEqual(first.updates.length, 1, "first subscriber update count");
        assertDeepEqual(second.updates.length, 1, "second subscriber update count");
        assertDeepEqual(first.updates, second.updates, "both subscribers see the same change");
      });

      it("stops notifying after unsubscribe, without affecting other subscribers", async () => {
        const stopped = recordUpdates();
        const kept = recordUpdates();
        await storage.save(KEY, "first");
        stopped.unsubscribe();
        await storage.save(KEY, "second");
        assertDeepEqual(stopped.updates.length, 1, "updates after unsubscribing");
        assertDeepEqual(kept.updates.length, 2, "updates for the remaining subscriber");
      });

      it("does not replay changes made before subscribing", async () => {
        await storage.save(KEY, "value");
        const { updates } = recordUpdates();
        await storage.get(KEY);
        assertDeepEqual(updates, [], "updates for a late subscriber");
      });

      it("does not notify when saving a deep-equal value", async () => {
        await storage.save(KEY, { a: 1, b: [1, 2] });
        const { updates } = recordUpdates();
        await storage.save(KEY, { b: [1, 2], a: 1 });
        assertDeepEqual(updates, [], "updates for a no-op save");
      });

      it("does not notify when removing a missing key", async () => {
        const { updates } = recordUpdates();
        await storage.remove(KEY);
        await storage.save(KEY, null);
        assertDeepEqual(updates, [], "updates for no-op removes");
      });

      it("reports changes to each key under that key", async () => {
        const { updates } = recordUpdates();
        await storage.save(KEY, 1);
        await storage.save(OTHER_KEY, 2);
        assertDeepEqual(
          updates.map((update) => update.key),
          [KEY, OTHER_KEY],
          "update keys",
        );
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
          await assertRejectsWith(
            () => storage.get(badKey),
            VaultStorageErrorCode.InvalidKey,
            "get",
          );
          await assertRejectsWith(
            () => storage.has(badKey),
            VaultStorageErrorCode.InvalidKey,
            "has",
          );
          await assertRejectsWith(
            () => storage.save(badKey, "value"),
            VaultStorageErrorCode.InvalidKey,
            "save",
          );
          await assertRejectsWith(
            () => storage.remove(badKey),
            VaultStorageErrorCode.InvalidKey,
            "remove",
          );
        });
      }

      const cyclic: Record<string, unknown> = { name: "cycle" };
      cyclic.self = cyclic;
      const unserializable: Array<[string, unknown]> = [
        ["a function", () => 1],
        ["a symbol", Symbol("s")],
        ["a bigint", BigInt(1)],
        ["NaN", Number.NaN],
        ["Infinity", Number.POSITIVE_INFINITY],
        ["a cyclic object", cyclic],
        ["an object containing a function", { ok: 1, nested: { callback: () => 1 } }],
        ["an array containing a symbol", [1, Symbol("s")]],
      ];
      for (const [label, value] of unserializable) {
        it(`rejects ${label} with NOT_SERIALIZABLE and keeps the previous value`, async () => {
          await storage.save(KEY, "previous");
          const { updates } = recordUpdates();
          await assertRejectsWith(
            () => storage.save(KEY, value),
            VaultStorageErrorCode.NotSerializable,
            "save",
          );
          assertDeepEqual(await storage.get(KEY), "previous", "get after failed save");
          assertDeepEqual(updates, [], "updates for a failed save");
        });
      }

      withHook(
        "quotaExceededOnSave",
        "rejects with QUOTA_EXCEEDED, changes nothing, and recovers",
        async (hook) => {
          await storage.save(KEY, "previous");
          const { updates } = recordUpdates();
          await hook(storage, KEY);
          await assertRejectsWith(
            () => storage.save(KEY, "next"),
            VaultStorageErrorCode.QuotaExceeded,
            "save",
          );
          assertDeepEqual(await storage.get(KEY), "previous", "get after failed save");
          assertDeepEqual(updates, [], "updates for a failed save");
          await storage.save(KEY, "next");
          assertDeepEqual(await storage.get(KEY), "next", "get after a later save");
        },
      );

      withHook(
        "unavailableOnSave",
        "rejects a save with UNAVAILABLE, changes nothing, and recovers",
        async (hook) => {
          await storage.save(KEY, "previous");
          const { updates } = recordUpdates();
          await hook(storage, KEY);
          await assertRejectsWith(
            () => storage.save(KEY, "next"),
            VaultStorageErrorCode.Unavailable,
            "save",
          );
          assertDeepEqual(await storage.get(KEY), "previous", "get after failed save");
          assertDeepEqual(updates, [], "updates for a failed save");
          await storage.save(KEY, "next");
          assertDeepEqual(await storage.get(KEY), "next", "get after a later save");
        },
      );

      withHook(
        "unavailableOnRemove",
        "rejects a remove with UNAVAILABLE, changes nothing, and recovers",
        async (hook) => {
          await storage.save(KEY, "previous");
          const { updates } = recordUpdates();
          await hook(storage, KEY);
          await assertRejectsWith(
            () => storage.remove(KEY),
            VaultStorageErrorCode.Unavailable,
            "remove",
          );
          assertDeepEqual(await storage.get(KEY), "previous", "get after failed remove");
          assertDeepEqual(updates, [], "updates for a failed remove");
          await storage.remove(KEY);
          assertDeepEqual(await storage.get(KEY), null, "get after a later remove");
        },
      );

      withHook(
        "unavailableOnGet",
        "rejects a get with UNAVAILABLE instead of resolving null",
        async (hook) => {
          await storage.save(KEY, "value");
          await hook(storage, KEY);
          await assertRejectsWith(() => storage.get(KEY), VaultStorageErrorCode.Unavailable, "get");
          assertDeepEqual(await storage.get(KEY), "value", "get after the failure");
        },
      );

      withHook(
        "unavailableOnHas",
        "rejects has with UNAVAILABLE instead of resolving false",
        async (hook) => {
          await storage.save(KEY, "value");
          await hook(storage, KEY);
          await assertRejectsWith(() => storage.has(KEY), VaultStorageErrorCode.Unavailable, "has");
          assertDeepEqual(await storage.has(KEY), true, "has after the failure");
        },
      );

      withHook(
        "corruptDataOnGet",
        "rejects unreadable stored data with CORRUPT_DATA instead of resolving null",
        async (hook) => {
          await storage.save(KEY, "value");
          await hook(storage, KEY);
          await assertRejectsWith(() => storage.get(KEY), VaultStorageErrorCode.CorruptData, "get");
        },
      );
    });

    describe("ordering", () => {
      it("settles concurrent saves to one key in call order, and the last one wins", async () => {
        const settled: number[] = [];
        const writes = [0, 1, 2, 3, 4].map((n) =>
          storage.save(KEY, { n }).then(() => {
            settled.push(n);
          }),
        );
        await awaitAll(writes);
        assertDeepEqual(settled, [0, 1, 2, 3, 4], "settle order");
        assertDeepEqual(await storage.get(KEY), { n: 4 }, "final value");
      });

      it("notifies concurrent saves in call order", async () => {
        const { updates } = recordUpdates();
        await awaitAll([1, 2, 3].map((n) => storage.save(KEY, n)));
        assertDeepEqual(
          updates.map((update) => [update.oldValue, update.newValue]),
          [
            [null, 1],
            [1, 2],
            [2, 3],
          ],
          "notified (old, new) pairs",
        );
      });

      it("applies interleaved saves and removes in call order", async () => {
        const settled: string[] = [];
        const track = (label: string, write: Promise<void>) =>
          write.then(() => {
            settled.push(label);
          });
        await awaitAll([
          track("save 1", storage.save(KEY, 1)),
          track("remove", storage.remove(KEY)),
          track("save 2", storage.save(KEY, 2)),
        ]);
        assertDeepEqual(settled, ["save 1", "remove", "save 2"], "settle order");
        assertDeepEqual(await storage.get(KEY), 2, "final value");
      });

      it("lets a read issued after a write, without awaiting it, observe that write", async () => {
        const write = storage.save(KEY, "value");
        const read = storage.get(KEY);
        const [, observed] = await awaitAll<unknown>([write, read]);
        assertDeepEqual(observed, "value", "read issued after save");
      });
    });
  });
}

function globalTestApi(): ContractTestApi {
  const candidate = globalThis as unknown as Partial<ContractTestApi>;
  if (
    typeof candidate.describe !== "function" ||
    typeof candidate.it !== "function" ||
    typeof candidate.beforeEach !== "function" ||
    typeof candidate.afterEach !== "function"
  ) {
    throw new Error(
      "runVaultStorageContract needs describe/it/beforeEach/afterEach globals; pass options.testApi when the runner does not provide them",
    );
  }
  return candidate as ContractTestApi;
}
