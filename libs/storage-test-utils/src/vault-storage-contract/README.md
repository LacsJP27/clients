# VaultStorage contract suite (C6)

A behavioral test suite that every `VaultStorage` implementation runs (ADR-0001). TypeScript checks
that an adapter has the right methods. This suite checks that the adapter behaves as the contract
says: absent values, read-your-writes, isolation, notifications, typed errors, and ordering.

- Contract: `libs/storage-core/src/vault-storage/vault-storage.ts` (`VaultStorage`,
  `VaultStorageError`)
- Reference implementation: `InMemoryVaultStorage` (C5), same folder
- Open decisions for the browser and desktop owners:
  [`OPEN_QUESTIONS.md`](../../../storage-core/src/vault-storage/OPEN_QUESTIONS.md)

## Plugging in an implementation

The minimum is a factory that returns a **fresh, empty** instance. The suite calls it once per test.

```ts
// apps/desktop/src/platform/main/storage/desktop-vault-storage.contract.spec.ts
import { runVaultStorageContract } from "@bitwarden/storage-test-utils";

import { DesktopVaultStorage } from "./desktop-vault-storage";

runVaultStorageContract("DesktopVaultStorage", () => new DesktopVaultStorage(new FakeBackend()));
```

That is enough to run every test except the failure scenarios. Those are skipped and appear in the
output as `[needs simulateFailure.<scenario>]`.

### Cleanup and failure hooks

```ts
runVaultStorageContract("BrowserVaultStorage", () => new BrowserVaultStorage(storageAreaDouble()), {
  // Runs after every test with that test's instance.
  cleanup: async (storage) => storage.dispose(),

  // Each hook arms ONE failure: the next matching operation on `key` must reject with the listed
  // code and leave stored data unchanged. Drive this through your API double, not the adapter.
  simulateFailure: {
    quotaExceededOnSave: (storage, key) => api.failNextSet(key, quotaErrorFromPlatform()),
    unavailableOnGet: (storage, key) => api.failNextGet(key, new Error("disk gone")),
    corruptDataOnGet: (storage, key) => api.writeRaw(key, "{not json"),
  },
});
```

| Scenario              | Next operation on `key` | Must reject with |
| --------------------- | ----------------------- | ---------------- |
| `quotaExceededOnSave` | `save`                  | `QUOTA_EXCEEDED` |
| `unavailableOnSave`   | `save`                  | `UNAVAILABLE`    |
| `unavailableOnRemove` | `remove`                | `UNAVAILABLE`    |
| `unavailableOnGet`    | `get`                   | `UNAVAILABLE`    |
| `unavailableOnHas`    | `has`                   | `UNAVAILABLE`    |
| `corruptDataOnGet`    | `get` (key holds data)  | `CORRUPT_DATA`   |

The failure tests are where adapters prove they **normalize** platform errors. A browser-extension
adapter has to map its runtime error to a `VaultStorageError`. A desktop adapter has to map its file
system errors the same way. If raw platform errors pass through, these tests fail.

### Other runners

The suite uses the runner's global `describe` / `it` / `it.skip` / `beforeEach` / `afterEach` and
its own assertions. It has no dependency on `expect`. Jest, Vitest (with globals), Mocha, and
Jasmine work as-is. Without globals, pass `options.testApi`.

## What a passing run does and does not prove

The suite runs against whatever `createStorage` returns. Against API doubles, it proves that the
adapter's translation logic is correct. It does **not** prove persistence across restarts or how
the real platform API behaves. ADR-0001 requires client integration tests against real storage for
those.

## Platform neutrality

The shared contract code must not reference browser-extension, desktop, or Node APIs: the
`vault-storage` and `secure-storage` folders of `libs/storage-core`, and the `contract-testing`,
`vault-storage-contract`, and `secure-storage-contract` folders here. `npm run
lint:platform-neutral` (part of `npm run lint`) enforces this in two ways:

1. A text scan rejects `chrome`, `electron`, `node:`, `fs`, and `Buffer`.
2. `tsc` runs with `tsconfig.platform-neutral.json` (`lib: ["ES2022"]`, `types: []`).

Spec files that use Jest's `expect` are excluded from the type check. The text scan still covers
them.

`SecureStorage` has the same kind of suite, `runSecureStorageContract`, in
`../secure-storage-contract`. For the adapters each client registers, see
[`docs/platform-contracts.md`](../../../../docs/platform-contracts.md).
