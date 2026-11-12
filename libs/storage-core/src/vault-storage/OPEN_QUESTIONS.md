# VaultStorage: open questions for the browser (C1) and desktop (C2) owners

The shared suite (C6) and `InMemoryVaultStorage` (C5) needed every behavior below to be pinned down.
Each one is a **proposal**. Please confirm or push back before C7 and C9 build against it. Each
decision names the suite tests that encode it, so changing a decision means changing those tests
deliberately.

Reviewers: browser-extension owners, desktop owners, and Platform (`libs/storage-core` owner).

## 1. Current behavior of C1 and C2

Read from the code; not yet verified against the running clients.

- **C1**: `AbstractChromeStorageService`
  (`apps/browser/src/platform/services/abstractions/abstract-chrome-storage-api.service.ts`)
- **C2**: `ElectronStorageService` + `CachedBackend` in the main process, plus
  `ElectronRendererStorageService` over IPC

| Behavior                                  | C1 browser extension                                                                                                       | C2 desktop                                                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing key                               | `null`                                                                                                                     | `null`                                                                                                                                                      |
| `save(k, null)`                           | Removes the key                                                                                                            | **Stores `null`** and emits `"save"`                                                                                                                        |
| `save(k, undefined)`                      | Removes the key                                                                                                            | Removes the key                                                                                                                                             |
| Serialization                             | `JSON.stringify` into a `{__json__: true, value}` wrapper; legacy unwrapped values are read as-is                          | Live object kept in an in-memory cache. JSON is applied only when written to disk                                                                           |
| `Set`                                     | Converted to an array                                                                                                      | Converted to an array                                                                                                                                       |
| `Date`, class instances, functions, `NaN` | Silently changed by JSON (`Date` → string, functions dropped, `NaN` → `null`); `BigInt` rejects with a raw `TypeError`     | Returned **unchanged until restart**, then changed by JSON. Reads change meaning across a restart                                                           |
| Isolation (mutating after save or read)   | Isolated, because values pass through JSON                                                                                 | **Not isolated in the main process**: the cache holds the caller's reference, and `get` returns it. The renderer is isolated only because IPC clones values |
| When `save` resolves                      | After the storage API callback, which means the value is committed                                                         | After the in-memory cache update. The disk write is **debounced 200 ms (max 5 s)**                                                                          |
| Write failures                            | Reject with `chrome.runtime.lastError` (untyped)                                                                           | Disk errors happen in a timer flush and **never reach the caller**. `save` cannot reject                                                                    |
| Read failures                             | Reject (untyped)                                                                                                           | Cannot fail (cache)                                                                                                                                         |
| Notification source                       | `storage.onChanged`, so writes from **every extension context** are seen. Multi-key changes are dropped                    | A main-process `Subject` emits only that process's writes. The renderer has its own `Subject` and sees **only its own** writes                              |
| Notification timing                       | Event dispatch, **asynchronous**, with no ordering guarantee relative to `save` resolving                                  | **Synchronous**, before `save` resolves                                                                                                                     |
| Notification payload                      | `key` and `updateType`. The platform supplies `oldValue`/`newValue`, but they are not exposed (they are serialized anyway) | `key` and `updateType` only                                                                                                                                 |
| No-op writes                              | Believed not to fire `onChanged` for an unchanged value or a missing-key remove. **Needs verification per browser**        | Always emits, including a remove of a missing key                                                                                                           |
| Ordering                                  | Calls are processed in order by the storage area (believed; verify on Safari)                                              | Synchronous, so in order                                                                                                                                    |

Neither client meets every proposal below today. That is expected (ADR-0001: "Writing down behavior
will surface existing differences"). The adapters close the gaps.

## 2. Behaviors decided for the contract

### 2.1 Absent value: `null`

Both clients already return `null`. `get` never resolves `undefined`, and `has(k)` is exactly
`get(k) !== null`.
_Tests:_ "resolves null for a key that was never saved", "treats saving null/undefined as remove".

### 2.2 Saving `null` or `undefined` is `remove`

This matches C1. C2 currently stores `null` and emits `"save"`. Under this decision, the C2 adapter
reports it as `"remove"`.
_Question:_ Does any desktop caller rely on a stored `null` being distinguishable from absence? It
cannot be distinguished through `get`/`has` today, so we believe no caller does.

### 2.3 Values are plain JSON data

The allowed values are `null`, booleans, finite numbers, strings, arrays, and plain objects.
Properties whose value is `undefined` are dropped. The suite requires `NOT_SERIALIZABLE` for:
functions, symbols, bigints, `NaN`/`±Infinity`, cyclic objects, and nested functions or symbols.

**Not decided, and not tested by the suite:** `Set`, `Map`, `Date`, and class instances. C5
rejects them. Both clients currently accept `Set` (as an array), and C1 accepts `Date` (as a
string). The options are:

- **(a)** Reject all of them. This is strict and matches C5, but it is a behavior change for current
  callers.
- **(b)** Keep accepting `Set` → array as a documented legacy conversion, and reject the rest.
- **(c)** Leave the behavior implementation-defined. We do not recommend this, because it is the
  divergence the ADR exists to remove.

We recommend **(b)** for compatibility. If confirmed, we will add a suite test for it.

### 2.4 Isolation

Values are copied on save, on read, and in each notification. **This requires a change in C2's main
process**, either by cloning in `CachedBackend` or in the adapter. It is a correctness bug today:
mutating a returned object silently changes the value that gets persisted.
_Tests:_ the "isolation" block.

### 2.5 Notification timing: after commit, before the write resolves

A subscriber is notified after the change is visible to reads and before the `save`/`remove`
promise resolves. So `await save()` followed by inspecting received updates is reliable, and a
subscriber that calls `get` sees the new value.
_Impact:_ This is incompatible with C1 relying directly on `onChanged`. The C1 adapter has to emit
its own notifications for its own writes.
_Tests:_ "notifies before the write's promise resolves", "notifies only after the change is visible
to reads".

### 2.6 No-op writes do not notify

Saving a deep-equal value (key order ignored) or removing an absent key emits nothing. We chose this
because it matches `onChanged` semantics, and it stops subscribers that write back from looping.
_Impact:_ C2 must compare before emitting, which is a deep compare per save. The alternative is
"every successful call notifies", which is cheaper for C2 and harder for C1. **Please confirm.**
_Tests:_ "does not notify when saving a deep-equal value", "does not notify when removing a missing
key".

### 2.7 Notification scope: open

The suite only checks changes made **through the same instance**. It does not decide whether a
subscriber also sees writes from other extension contexts, other renderer windows, or the main
process. C1 sees them today and C2 does not. Options:

- **(a)** Same-instance only, guaranteed. Cross-context visibility is a separate optional capability
  reported through `SupportStatus`.
- **(b)** All writers to the same underlying storage. C2 would need IPC fan-out, and 2.5's timing
  guarantee only holds for local writes.

We recommend **(a)** for this proof of concept.

### 2.8 Notifications carry `oldValue` and `newValue`

The task asked for old and new values. Both are subscriber-owned copies, `null` when absent.
_Concerns for owners:_

- Every write now parses or copies values for each subscriber.
- Vault data reaches every subscriber, not just readers of that key.

If either is a problem, the alternative is `key` + `updateType` only, with subscribers calling `get`
themselves (today's `StorageUpdate`).

### 2.9 No replay

`updates$` is hot. A late subscriber does not receive earlier changes.
_Test:_ "does not replay changes made before subscribing".

### 2.10 Error model

Every failure rejects with `VaultStorageError` and a `code`. Nothing throws synchronously; this
covers invalid keys and unserializable values too. The original platform error goes in `cause`.
Messages carry no keys or values.

| Code               | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| `INVALID_KEY`      | Key is not a non-empty string                                   |
| `NOT_SERIALIZABLE` | Value is outside the JSON data domain (2.3)                     |
| `QUOTA_EXCEEDED`   | Write would exceed capacity                                     |
| `CORRUPT_DATA`     | A stored value exists but cannot be decoded. It is never `null` |
| `UNAVAILABLE`      | Any other backend failure                                       |

- **Failed writes change nothing and do not notify.**
- **Failed reads are never reported as absent.** This is the ADR's "failures are never mistaken for
  empty data".

_Questions:_

- Is `UNAVAILABLE` too coarse? Possible additions: `PERMISSION_DENIED`, or `DISPOSED` for a closed
  adapter.
- `INVALID_KEY` only rejects non-strings and `""`. Should there be a maximum key length, or
  reserved prefixes? `conf` reserves `__internal__` for object-form keys.

### 2.11 Write completion means visible, not durable

When `save` resolves, every later read on this instance observes the value. **Durability is not
promised.** C2 resolves before its debounced disk write and can lose up to ~5 s of writes on a
crash, and its disk errors cannot reach the caller.
_Question:_ Should the contract add an explicit durability signal, such as `flush(): Promise<void>`,
or a status? Or is "visible" enough for vault records? The ADR's restart-persistence test needs an
answer before C9.

### 2.12 Ordering

Operations on a key, including reads, take effect and settle in call order. A `get` issued after an
un-awaited `save` observes that save.
_Tests:_ the "ordering" block.
_Question for C1:_ Confirm that this holds for `storage.local` on every supported browser, Safari in
particular. Otherwise the adapter needs a per-key queue.

### 2.13 Unspecified on purpose (flag if you disagree)

- What happens when a subscriber throws. C5 delegates to RxJS, which reports the error
  asynchronously, and the write still succeeds.
- How quota is measured. C5 counts UTF-16 code units of key + JSON.
- Ordering **across** different keys.

## 3. Proposed interface (feeds C3)

No existing `VaultStorage` interface was found, so one was drafted in `vault-storage.ts`. **Nothing
existing was changed.** `StorageService` and `ObservableStorageService` are untouched. The only
existing files edited are two barrel `index.ts` exports and the root `lint` script.

Proposals for review:

1. **`VaultStorage` is a new abstract class.** It is not a modification of `StorageService`, and it
   doubles as the runtime DI token the ADR requires.
2. **No `options?: StorageOptions` parameter.** `StorageLocation` selection belongs in bootstrap,
   by registering a different instance, not in feature calls.
3. **No `valuesRequireDeserialization`.** Values are always plain JSON data in and out (2.3). State
   code that branches on this flag would treat `VaultStorage` as `true`.
4. **`get<T>` returns `Promise<T | null>`** instead of `Promise<T>`, which made absence explicit.
5. **`updates$` is part of the contract.** Today it is the separate `ObservableStorageService`.
6. **`VaultStorageUpdate` adds `oldValue` and `newValue`** (2.8). It stays structurally assignable to
   `StorageUpdate`, so an existing service can expose a single stream.
7. **`VaultStorageError` and `VaultStorageErrorCode`** are new. `VaultStorageErrorCode` is a frozen
   const object plus a type, per ADR-0025.
8. **Is `has` worth keeping?** It is derivable from `get`. It is kept because both clients and
   existing callers have it.
9. **Naming:** Repo convention would be `VaultStorageService` / `vault-storage.service.ts`. The task
   used `VaultStorage`, so we kept that. Rename before C7 if Platform prefers the convention.

If C1 or C2 should declare `implements VaultStorage` on their **existing** services (ADR preference)
instead of using wrappers, 2.2, 2.4, 2.5, and 2.10 are breaking changes for those services. That is
the main reason the adapters will likely be thin wrappers.
