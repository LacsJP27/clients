# AGENTS.md — Bitwarden Clients

Canonical instructions for AI coding agents working in this repository. `CLAUDE.md` points here.
Agent-specific rule files remain authoritative where they exist; this file provides the orientation
they assume.

@.claude/CLAUDE.md

## What this repository is

This is `bitwarden/clients`: the monorepo for every Bitwarden client **except** mobile
([iOS](https://github.com/bitwarden/ios), [Android](https://github.com/bitwarden/android)). It is a
password manager, so the code handles vault data, encryption keys, and account secrets. The security
rules in the included configuration above are not stylistic preferences — treat them as hard
constraints.

The clients talk to a separate backend ([`bitwarden/server`](https://github.com/bitwarden/server):
API, identity, notifications). Nothing in this repository deploys or owns that backend, and no
database is needed to build or test the clients.

### The four clients

| App            | Runtime and platform APIs                                                                            | What it is                   |
| -------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| `apps/web`     | Angular, Web APIs, `localStorage` / `sessionStorage`                                                 | Web vault, incl. self-hosted |
| `apps/browser` | Angular + Lit (autofill UI), WebExtension APIs, `chrome.storage`, runtime messaging, content scripts | Browser extension (MV3)      |
| `apps/desktop` | Electron, Angular, `electron-store`, main/renderer IPC, Rust N-API (`apps/desktop/desktop_native`)   | Desktop app                  |
| `apps/cli`     | Node.js, Commander, Koa, `lowdb`, filesystem                                                         | `bw` command-line client     |

The same shared feature code must work across all four despite platform APIs that differ in return
values, timing, permissions, lifecycle, and failure modes. That mismatch is the subject of
[ADR-0001](./docs/adr/0001-shared-platform-contracts.md).

## Where things live

### Applications

- `apps/<client>/` — single-client code. Each app is self-contained.
- Client entry points worth knowing: `apps/browser/src/background/main.background.ts`,
  `apps/desktop/src/main.ts`, `apps/web/src/app/core/core.module.ts`, `apps/cli/src/commands/`.
- `bitwarden_license/bit-{web,browser,desktop,cli,common}/` — commercial (non-GPL) extensions of the
  OSS clients. Mirrors the `apps/` layout; licensing differs, so do not move code between them
  casually.

### Shared libraries (`libs/`)

Layering matters more than the folder name:

- `libs/common/` — shared by **all** clients, including the non-Angular CLI. No Angular APIs here:
  no `@Injectable`, no `inject()`, no decorators, no template references.
- `libs/angular/` — shared by the Angular clients only (web, browser, desktop). Angular APIs allowed.
- Domain libraries follow the same split based on who consumes them:
  - Platform & state: `platform`, `state`, `state-internal`, `storage-core`, `messaging`,
    `serialization`, `logging`, `scheduling`, `managed-settings`, `client-type`, `node`
  - Crypto & keys: `key-management`, `key-management-ui`, `user-crypto-management`, `legacy-crypto`,
    `unlock`
  - Domain: `vault`, `auth`, `admin-console`, `billing`, `subscription`, `pricing`, `tools`,
    `importer`, `dirt`, `pam`, `user-core`, `auto-confirm`, `organization-invite-link`
  - UI: `components` (the design system), `ui`, `assets`, `storybook`
  - Tooling & test support: `eslint`, `nx-plugin`, `core-test-utils`, `state-test-utils`,
    `storage-test-utils`, `automation-driver`, `guid`, `shared`

Place new code **as deep and as narrow as possible**. Promote to a shared `libs/` only when a second
client actually needs it. Boundaries between apps and libraries are enforced — consult
`eslint.config.mjs` and `nx.json` before adding a cross-dependency.

### Documentation

- `README.md` — project overview and links.
- `CONTRIBUTING.md` — contribution process.
- `docs/` — repository-local documentation (`cipher-types.md`, `using-nx-to-build-projects.md`,
  `class-ci-cd.md`).
- `docs/adr/` — architecture decision records recorded in this repository. Read
  `docs/adr/README.md` before adding one. Upstream Bitwarden ADRs live separately at
  [contributing.bitwarden.com/architecture/adr](https://contributing.bitwarden.com/architecture/adr/)
  and are referenced by URL from `.claude/rules/`.
- `.github/PULL_REQUEST_TEMPLATE.md` — the PR shape to fill in.

### Agent instruction files

Scoped instructions apply on top of this file. Read the one covering the code you are touching:

- `.claude/CLAUDE.md` — repo-wide critical rules (included above).
- `apps/web/CLAUDE.md`, `apps/browser/CLAUDE.md`, `apps/desktop/CLAUDE.md`, `apps/cli/CLAUDE.md`
- `libs/auth/CLAUDE.md`, `libs/components/CLAUDE.md`
- `.claude/rules/*.md` — path-scoped rules, each declaring its own `paths:` glob in frontmatter:

| Rule file                                    | Applies to                                            |
| -------------------------------------------- | ----------------------------------------------------- |
| `angular.md`, `typescript.md`                | `**/*.ts`                                             |
| `angular-components.md`                      | `**/*.component.ts`, `**/*.component.html`            |
| `tailwind.md`                                | `**/*.html`, `**/*.component.ts`, `**/*.directive.ts` |
| `testing.md`                                 | `**/*.spec.ts`                                        |
| `storybook-routing.md`                       | `**/*.stories.ts`                                     |
| `i18n.md`                                    | `apps/**` and `libs/**` `.ts` / `.html`               |
| `autofill-content-scripts.md`                | `apps/browser/src/autofill/content/**`                |
| `flatpak-manifest.md`, `snap-permissions.md` | desktop / CLI packaging manifests                     |

## Working in this repo

Node `>=24.17.0` and npm `~11` are required (`.nvmrc` pins v24). Rust for the desktop native module
is pinned in `apps/desktop/desktop_native/rust-toolchain.toml`.

Verification commands (also listed in the included configuration):

| Command                                                 | Purpose                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run lint:fix`                                      | ESLint with fixes                                                          |
| `npm run prettier`                                      | Prettier formatting                                                        |
| `npm run test:types`                                    | Workspace type-check — Jest's isolated compilation does **not** type-check |
| `npm test`                                              | Jest; scope with `npm test -- <path-or-pattern>`                           |
| `npm run storybook`                                     | Design-system component workshop                                           |
| `npm run debug:browser` / `debug:desktop` / `debug:cli` | Run a client locally                                                       |

Fix the underlying issue when any of these fail. Do not skip hooks or bypass failures.

### Conventions to expect

- TypeScript throughout; RxJS observables are the normal way state crosses service boundaries.
- Nx + npm workspaces; Webpack per client; Jest per project with its own `jest.config.js`.
- Tailwind classes **must** carry the `tw-` prefix — a missing prefix silently does nothing.
- Jest mocks follow the pattern in `.claude/rules/testing.md`.
- Angular code is being modernized (standalone components, signals, `inject()`); match the
  surrounding file rather than mixing idioms in one place.

## Architectural direction

Active architectural work is recorded in `docs/adr/`. The current entry,
[ADR-0001 Shared Platform Contracts](./docs/adr/0001-shared-platform-contracts.md), defines a
boundary between shared application logic and platform-specific behavior: platform-neutral contracts
in shared libraries, client-specific adapters, registration during client bootstrap, explicit
capability-status reporting, and one shared behavioral test suite per contract. If you are adding
code that imports a Chrome, Electron, or Node API from shared library code, read that ADR first.
