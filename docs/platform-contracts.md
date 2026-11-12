# Platform contracts

What [ADR-0001](./adr/0001-shared-platform-contracts.md) looks like in the code: which contracts
exist, where each client's adapter lives, where it is registered, and how each piece is tested.

## The pieces

```text
feature code ──► contract (shared, platform-neutral)
                    ▲
                    │ implemented by
     shared adapter core (all platform-independent rules, once)
                    ▲
                    │ configured by
     client adapter (the client's existing service + its error translation)
                    ▲
                    │ constructed in
     client bootstrap (and checked by validatePlatformContracts)
```

A client adapter is a few lines: it names the client's existing storage service as the backend and
translates that platform's failures into the contract's error codes. Everything else the contract
promises (validation, isolation, ordering, notifications, the error model) is in the shared core,
so it cannot drift between clients.

## Contracts

| Contract                         | Kind       | Defined in                                                                 | Shared suite               |
| -------------------------------- | ---------- | -------------------------------------------------------------------------- | -------------------------- |
| `VaultStorage`                   | Required   | `libs/storage-core/src/vault-storage/`                                     | `runVaultStorageContract`  |
| `SecureStorage`                  | Capability | `libs/storage-core/src/secure-storage/`                                    | `runSecureStorageContract` |
| `SecureStorageCapability`        | Status     | `libs/common/src/platform/capabilities/secure-storage.capability.ts`       | `capabilities.spec.ts`     |
| `SystemNotificationsCapability`  | Status     | `libs/common/src/platform/capabilities/system-notifications.capability.ts` | `capabilities.spec.ts`     |
| `SystemAuthenticationCapability` | Status     | `libs/key-management/src/biometrics/system-authentication.capability.ts`   | its own spec               |

Every contract is an abstract class, which is also its runtime token.

A capability reports one of four states through `SupportStatus` (`supported`,
`needs-configuration`, `unavailable`, `not-supported`), and feature code receives the service only
from a `supported` status. See `PlatformCapability` in
`libs/common/src/platform/capabilities/platform-capability.ts`.

Autofill is not covered. Its existing abstraction is specific to the extension and exposes browser
tab types; a neutral contract needs a design agreed with its owners first.

## Adapters and registration

| Client                 | `VaultStorage`                                            | Secure storage                                         | Registered in                                         |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Web                    | `WebVaultStorage` over session storage                    | not supported                                          | `apps/web/src/app/core/core.module.ts`                |
| Extension (popup)      | `BrowserVaultStorage` over extension local storage        | not supported                                          | `apps/browser/src/popup/services/services.module.ts`  |
| Extension (background) | same                                                      | not supported                                          | `apps/browser/src/background/main.background.ts`      |
| Desktop (renderer)     | `DesktopVaultStorage` over the bridge to the main process | `DesktopSecureStorageCapability` (OS credential store) | `apps/desktop/src/app/services/services.module.ts`    |
| Desktop (main)         | `DesktopVaultStorage` over the store                      | not registered in this process                         | `apps/desktop/src/main.ts`                            |
| CLI                    | `CliVaultStorage` over the data file                      | `CliSecureStorageCapability` (session-protected)       | `apps/cli/src/service-container/service-container.ts` |

The system notifications and system authentication capabilities report on services every client
already registers, so one implementation serves all clients. The Angular clients get it from
`libs/angular/src/services/jslib-services.module.ts`; the extension background and the CLI
construct it in the files above.

Each bootstrap ends its registration with `validatePlatformContracts`, which stops startup with a
`MissingPlatformContractError` naming any contract left unregistered.

Nothing consumes these registrations yet. Existing features still use the previous storage
services, which the adapters wrap, so both paths read and write the same data in the same format.

## Testing

- **Shared suites** (`libs/storage-test-utils`) run against the reference implementation, the
  shared adapter core over a deliberately badly behaved backend, and every client adapter over a
  double of that client's platform API. Each client's run lives beside its adapter as
  `*.contract.spec.ts`.
- **Failure scenarios** are driven through the platform double, so they prove each adapter
  translates its own platform's errors. A scenario a platform cannot produce is skipped and shows
  in the output as `[needs simulateFailure.<scenario>]`.
- **Existing-data compatibility** has a test per client: data in the client's current stored format
  is read through the adapter, and data written through the adapter is in that same format.
- **Platform neutrality** of the shared code is enforced by `npm run lint:platform-neutral`.

To add an adapter, write the class, then a spec that calls the suite with a factory:

```ts
runVaultStorageContract("MyVaultStorage", () => new MyVaultStorage(platformDouble()));
```

## Differences the contracts surfaced

Recorded here because the ADR asks for them, and because each is a behavior the previous services
left implicit.

- **Desktop durability.** A resolved write is visible to reads but reaches disk on a debounced
  flush, and a failed flush is not reported to the writer. `VaultStorage` promises visibility only.
- **Desktop main process isolation.** The store holds and returns the caller's own object. The
  adapter copies on the way in and out.
- **Extension notifications.** The platform's change event is asynchronous and also reports other
  contexts' writes. The adapter emits its own notifications, for its own writes only.
- **CLI secure storage accepts Base64 only**, and its underlying service answers "absent" when the
  session cannot unlock a stored value. The adapter rejects other values with `INVALID_VALUE` and
  reports the second case as `ACCESS_DENIED`.
- **CLI keys are paths** in the data file, so a key containing `.` or `[` addresses a nested value.
- **`Set` values.** The previous services store a `Set` as an array; the contract rejects it. See
  `libs/storage-core/src/vault-storage/OPEN_QUESTIONS.md`, 2.3.
- **Cross-context notifications** are not part of the contract (`OPEN_QUESTIONS.md`, 2.7).
