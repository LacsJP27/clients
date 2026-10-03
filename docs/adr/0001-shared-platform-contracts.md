# ADR-0001 — Shared Platform Contracts

- **Status:** Proposed
- **Date:** 2026-10-02
- **Deciders:** Platform, plus owners of each participating client
- **Affects:** `libs/common`, `libs/storage-core`, `libs/platform`, `apps/browser`, `apps/desktop`;
  later `apps/web`, `apps/cli`
- **Previously identified as:** E1 — Strengthen Existing Platform Capability Interfaces

## Context

Bitwarden ships four clients from this repository, each on a different platform stack:

| Client            | Representative platform technologies                                                 |
| ----------------- | ------------------------------------------------------------------------------------ |
| Web vault         | Angular, Web APIs, `localStorage`, `sessionStorage`                                  |
| Browser extension | Angular, WebExtension APIs, `chrome.storage`, runtime messaging, content scripts     |
| Desktop           | Electron, `electron-store`, renderer/main IPC, Rust N-API, operating-system services |
| CLI               | Node.js, Commander, `lowdb`, filesystem APIs                                         |

Shared features need comparable capabilities in all four, but the underlying APIs differ in return
values, timing, permissions, lifecycle rules, and failure modes. Without a firm boundary, feature
code accumulates platform checks, imports platform APIs directly, or depends on behavior that holds
for one implementation and not another.

Partial abstractions already exist and are the starting point rather than a blank slate:

- `libs/storage-core/src/storage.service.ts` declares `StorageService` as an **abstract class** with
  `get` / `has` / `save` / `remove`, plus a separate `ObservableStorageService` exposing
  `updates$: Observable<StorageUpdate>`. Being a class, it already works as a runtime DI token.
- `libs/common/src/platform/misc/support-status.ts` defines `SupportStatus<T>` as
  `Supported<T> | NeedsConfiguration | NotSupported`, with a `supportSwitch` RxJS operator. It
  models three states; it has no representation for a capability that is supported but
  _temporarily_ unavailable.
- Platform-specific behavior that the current abstraction does not describe:
  `libs/common/src/platform/storage/window-storage.service.ts` (browser-window storage),
  `apps/desktop/src/platform/main/storage/cached-backend.ts` (cached and delayed desktop
  persistence), `libs/common/src/platform/services/sdk/client-managed-state.ts` (SDK record bridge
  with optimistic state).
- Unsupported capabilities are signaled inconsistently — compare
  `apps/desktop/src/platform/services/electron-renderer-secure-storage.service.ts` with
  `apps/desktop/src/platform/services/illegal-secure-storage.service.ts`, which throws rather than
  reporting a status.
- Abstractions that leak platform types into shared logic:
  `apps/browser/src/autofill/services/abstractions/autofill.service.ts` exposes Chrome tab types.

The gap is behavioral, not syntactic. `StorageService` constrains method signatures; it does not say
when a `save()` is complete, whether a read immediately afterwards must observe the value, or how a
quota or serialization failure is reported. TypeScript cannot check any of that.

## Decision

Establish an explicit boundary between shared application logic and platform-specific behavior, made
of five components:

1. **Shared platform contracts.** Platform-neutral TypeScript contracts in shared libraries defining
   operations, inputs, results, errors, availability states, and **behavioral guarantees**. A
   contract must not import Electron, Chrome, DOM tab, or native OS types. Documented semantics are
   part of the contract, not commentary on it.
2. **Client-specific adapters.** Implementations using one client's APIs — `chrome.storage` in the
   extension, `electron-store` on desktop, `lowdb` or Node `fs` in the CLI. An existing platform
   service whose behavior already matches the contract declares `implements Contract` directly; a
   thin wrapper is added only where translation or normalization is genuinely needed. Working
   platform code is not duplicated to produce new class names.
3. **Client bootstrap registration.** Each client's existing startup code registers its
   implementations: DI providers and typed injection tokens in the Angular clients
   (`apps/web/src/app/core/core.module.ts`, `apps/browser/src/background/main.background.ts`,
   desktop renderer modules), explicit construction elsewhere (`apps/desktop/src/main.ts`,
   `apps/cli/src/commands/`). Because TypeScript interfaces do not exist at runtime, each contract
   needs a runtime identifier — an injection token, abstract class, or symbol. Bootstrap does not
   detect the platform; each entry point already knows which client it is starting. Required
   bindings are validated at startup so a missing implementation fails loudly.
4. **Explicit capability-status reporting.** Optional capabilities report state through the existing
   `SupportStatus` pattern rather than scattered booleans, absent methods, or
   `Method not implemented` exceptions. Four states must be distinguishable: supported and ready;
   supported but requiring permission or configuration; temporarily unavailable; unsupported on this
   client or platform. The current three-member `SupportStatus<T>` is extended with an
   `unavailable` variant rather than replaced, keeping `supportSwitch` callers working.
5. **Shared contract tests.** Every implementation of a contract runs the same behavioral suite,
   parameterized over adapter factories. Client-specific unit tests still cover API translation, and
   guarantees a mock cannot prove — restart persistence, OS permissions — additionally require a
   client integration test.

The resulting runtime relationship:

```text
Shared feature or core service
            ↓ calls
Shared platform contract
            ↓ implemented by
Client-specific adapter selected during bootstrap
            ↓ translates to
Browser, Electron, Node.js, or operating-system API
```

A feature developer writes `await vaultStorage.save(key, value)` without choosing an implementation.
Internal APIs, disk timing, and available capabilities may still differ per client; what must not
differ is the contract's documented promise.

### Rules that follow

- One contract per capability; keep contracts small.
- Vault storage and secure key storage are **separate** contracts. Browser storage is not equivalent
  to an OS keychain, and a single contract would imply a protection guarantee the web and extension
  cannot keep.
- Business rules stay in shared domain and feature services; adapters hold only API translation,
  permissions, lifecycle handling, and platform error normalization.
- Implementation selection stays in bootstrap, never in feature code.
- Unsupported capabilities are modeled explicitly, never by throwing.
- A shared contract test suite exists before a second implementation of that contract is added.
- Platform capability does not get removed because another client lacks it; capability status and
  focused optional contracts let clients support different feature sets honestly.

### Contract groups

Introduced incrementally, not designed all at once:

- **Storage:** vault storage (encrypted vault records and ordinary application state) and secure
  storage (protected key material, using stronger platform protection where available).
- **Feature capabilities:** autofill (fill an approved target without exposing Chrome tab or DOM
  types to shared logic), system notifications (see
  `libs/common/src/platform/system-notifications/system-notifications.service.ts`), and system
  authentication (status, user verification, persistent unlock where the platform provides it — see
  `libs/key-management/src/biometrics/biometric.service.ts`).

Further capabilities are added only when multiple callers or clients benefit from a stable boundary.
This is not a mandate to put an interface in front of every class.

### Scope of the first implementation

`VaultStorage` on the **browser extension** and **desktop** clients. Storage is used by every
client, has externally observable behavior, and can be proven without restructuring the application;
those two clients differ most in storage technology and lifecycle, so agreement between them is
meaningful evidence.

Steps: inventory and document current extension and desktop storage behavior; define the smallest
useful contract around read, write, remove, and change visibility; fix the exact semantics of a
completed write and a subsequent read; make each existing service implement the contract (wrapping
only where necessary); register both in existing startup configuration; move one narrow cipher
read/write path to depend only on `VaultStorage`; run one shared suite against both; then run the
real workflow in both clients against real storage APIs.

Done when: one real feature performs storage through the contract; that feature imports no Chrome,
Electron, Node, or adapter types; both implementations pass the same behavioral suite; write
completion and read visibility have a verified meaning; failures propagate as specified rather than
surfacing as empty results; swapping the injected implementation requires no feature change;
existing stored data stays readable with **no migration**; and capability or failure states are
reported consistently.

## Alternatives considered

- **Keep the status quo.** `StorageService` plus ad-hoc platform services. Rejected: it constrains
  signatures only, so behavioral divergence keeps reaching feature code as platform conditionals and
  per-client bugs.
- **One broad platform interface.** A single `Platform` abstraction covering storage, autofill,
  notifications, and authentication. Rejected: it couples unrelated capabilities and forces clients
  to implement methods they cannot support, which is exactly what produces
  `Method not implemented`.
- **Lowest-common-denominator contracts.** Expose only what all four clients support. Rejected: it
  would discard real platform strengths such as OS keychains and biometric unlock. Capability status
  preserves them instead.
- **Replace the platform services with new adapter classes everywhere.** Rejected as duplication
  with ongoing maintenance cost; existing services implement the contract directly where their
  behavior already matches.
- **Runtime platform detection inside a factory.** Rejected: each entry point already knows its
  client, and detection hides the wiring that bootstrap should make obvious.

## Consequences

### Positive

- Feature code depends on one documented promise instead of four platform behaviors.
- Platform translation lives in one reusable place per client.
- Capability availability becomes a value features can branch on before invoking or displaying.
- Behavioral equivalence becomes testable, and divergence becomes a test failure rather than a
  field report.
- Swapping or adding a client implementation stops requiring feature changes.

### Negative

- A runtime token per contract adds indirection beyond a plain TypeScript interface.
- Shared suites plus client integration tests cost more test time than mock-only unit tests.
- Writing down behavior will surface existing differences between clients that must be resolved
  rather than tolerated.
- Partially migrated code temporarily carries both the old service and the new contract.

### Neutral

- Platform-specific code is not removed; it is relocated and contained.
- Existing storage keys and formats are untouched. Storage-format migration is a separate project
  with its own compatibility and recovery plan.
- Performance is measured separately; it is not the success criterion here.

### Risks and mitigations

- _Contracts grow too broad_ — separate contracts per capability; review additions against the
  one-capability rule.
- _Interfaces describe syntax but not behavior_ — document guarantees and enforce them with the
  shared suite.
- _Adapters duplicate existing services_ — prefer `implements` on existing services; wrappers only
  for translation.
- _Bootstrap becomes a service locator_ — bootstrap constructs and registers only; features receive
  typed dependencies by injection and never look them up.

## Validation

Equivalence is tested against the contract's observable promises, not by comparing internal API
calls, and not by requiring every platform to offer every capability. Each adapter that reports
support receives the same inputs and must produce the same outputs, with isolated storage per case.

| What to test                           | How                                                                                                                   | Evidence of success                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Contract shape and dependency boundary | Type-check each implementation; lint or inspect the migrated feature's imports                                        | Every adapter implements the contract; feature code imports no Chrome, Electron, Node, or adapter types      |
| Read, save, overwrite, remove          | One reusable suite over extension and desktop adapter factories, fresh storage per case                               | Same inputs produce the same values, the same missing-value result, and the same completion behavior         |
| Save completion and visibility         | Delay the underlying write, then read immediately after the returned promise resolves; exercise `updates$` separately | Observed value and notifications match the documented timing guarantee in both clients                       |
| Existing-data compatibility            | Seed storage with records written by the current implementation, then read and update through the adapter             | Existing records stay readable and keep their format                                                         |
| Errors and partial failure             | Inject rejected writes, quota and disk errors, malformed stored data, and serialization failures via API doubles      | Both adapters return the specified error or result; failures are never mistaken for empty data               |
| Isolation                              | Separate accounts or namespaces, with concurrent operations in the shared suite                                       | One account's reads, writes, and notifications do not affect another                                         |
| Persistence across restart             | Recreate the adapter or client against the same temporary profile or storage directory                                | Values promised durable survive restart                                                                      |
| Capability availability                | Stub supported, permission-required, unavailable, and unsupported states                                              | Each status is reported consistently; feature code invokes only a ready capability                           |
| Bootstrap wiring                       | Start each client's container and resolve the contract token; test a missing binding                                  | Extension resolves browser storage, desktop resolves desktop storage, missing required binding fails clearly |
| Real feature workflow                  | Run the chosen cipher read/write workflow in both clients against actual platform storage                             | Same feature code, same user-visible result, failures propagated as specified                                |

Unit-level API doubles force the rare failures; extension and desktop integration tests confirm the
real APIs honor the contract. A mock-only pass does not establish adapter equivalence. No server or
database is required — the adapters operate on client storage.

Record, per implementation: the shared-suite result, any contract differences discovered, the
platform imports and conditionals removed from the migrated feature, and the outcome of the real
workflow.

## Implementation phases

1. **Discovery and contract definition** — inventory existing abstractions, find direct platform
   imports in shared code, record current behavior including error handling and update timing,
   define neutral request/result/error/status types, review with client owners.
2. **Implement or wrap** — prefer `implements Contract` on existing services; wrap only to translate
   or normalize; keep platform imports inside client code; normalize errors and status at the
   boundary; keep business rules out of adapters.
3. **Bootstrap registration** — add a runtime token per contract, register per client, keep platform
   selection in bootstrap, validate required bindings at startup.
4. **Migrate one vertical slice** — one small, frequently used workflow, switched from a concrete
   platform service to the contract, with user-visible behavior preserved.
5. **Contract and integration testing** — one shared suite per implementation, plus client
   integration tests against real storage in isolated profiles or temporary directories.
6. **Controlled expansion** — storage feature by feature; secure storage after ordinary storage is
   stable; autofill, notifications, and system authentication independently. Superseded
   abstractions are removed only after all callers have migrated and compatibility is verified.

The decision to expand beyond the extension and desktop storage proof of concept is a separate one
and will be recorded as its own ADR.

## Illustrative example

The contract states what feature code may request:

```ts
export interface Clipboard {
  copy(text: string): Promise<void>;
}
```

Adapters state how it is performed:

```ts
export class ElectronClipboardAdapter implements Clipboard {
  async copy(text: string): Promise<void> {
    electron.clipboard.writeText(text);
  }
}

export class BrowserClipboardAdapter implements Clipboard {
  async copy(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }
}
```

Each bootstrap registers its own:

```ts
// Desktop startup
providers: [{ provide: CLIPBOARD, useClass: ElectronClipboardAdapter }];

// Browser startup
providers: [{ provide: CLIPBOARD, useClass: BrowserClipboardAdapter }];
```

The feature receives the implementation and uses only the contract:

```ts
export class CopyUsernameFeature {
  constructor(@Inject(CLIPBOARD) private readonly clipboard: Clipboard) {}

  copy(username: string): Promise<void> {
    return this.clipboard.copy(username);
  }
}
```

Clipboard is used here only because it is small. `VaultStorage` is the capability actually being
implemented first.

## References

- Architecture diagram: `./assets/bitwarden-architecture-e1-red.svg` _(not yet committed)_
- Existing storage abstraction: `libs/storage-core/src/storage.service.ts`
- Existing support-status pattern: `libs/common/src/platform/misc/support-status.ts`
- Browser-window storage behavior: `libs/common/src/platform/storage/window-storage.service.ts`
- SDK record bridge and optimistic state: `libs/common/src/platform/services/sdk/client-managed-state.ts`
- Cached desktop persistence: `apps/desktop/src/platform/main/storage/cached-backend.ts`
- Desktop secure storage: `apps/desktop/src/platform/services/electron-renderer-secure-storage.service.ts`
- Unsupported secure storage: `apps/desktop/src/platform/services/illegal-secure-storage.service.ts`
- Autofill abstraction with browser-specific types: `apps/browser/src/autofill/services/abstractions/autofill.service.ts`
- System notifications: `libs/common/src/platform/system-notifications/system-notifications.service.ts`
- Biometrics and system authentication: `libs/key-management/src/biometrics/biometric.service.ts`
- Client composition and startup: `apps/web/src/app/core/core.module.ts`,
  `apps/browser/src/background/main.background.ts`, `apps/desktop/src/main.ts`,
  `apps/cli/src/commands/serve.command.ts`
- [Clients architecture](https://contributing.bitwarden.com/architecture/clients)
- [Upstream Bitwarden ADRs](https://contributing.bitwarden.com/architecture/adr/)
