# CLAUDE.md


## Overview

**noorm** - Database Schema & Change Manager with Ink/React TUI.

Manage database configs, execute SQL changes, run templated SQL files. Core modules emit events via `@logosdx/observer`, CLI subscribes. Configs stored encrypted in `.noorm/state/state.enc`. Headless mode for CI/CD with JSON output.

This repo is one of two in the noorm realm; the sibling is `noormdev/ignatius`, the IDEF1X/SSADM
modeler that renders the models under `docs/models/`. Separate git history, issues, and releases —
name the repo before acting in it, because a bare PR or issue number is ambiguous across the two.


## Commands

```bash
bun run build                   # Build project
bun run test                    # Run tests
bun run test:watch              # Watch mode
bun run test:coverage           # With coverage
bun run dev                     # Development with ts-node
bun run lint                    # Lint
bun run typecheck               # Type check
```


## Running Tests

A single `bun test` (whole suite, one process) does **not** reflect CI. CI splits the suite into five
independent `bun test --serial` invocations, each in a fresh process — see `.github/workflows/ci.yml`
for the split and [`docs/wiki/index.md`](docs/wiki/index.md) for the exact per-group commands.

The split exists because cross-file pollution produces hundreds of false failures in the unified run
while CI is green. When triaging a "broken" test, **run the file in isolation first**; if it passes
alone, the failure is contamination, not a regression.

**`mock.module` never restores.** Bun's mock registry is process-global, and re-registering the real
module does *not* undo a mock — measured directly. Every `afterAll(() => mock.module(..., () => actualX))`
in this repo is therefore a no-op, despite the "restore mocked modules to prevent pollution" comments
next to them. A file that mocks a module poisons every file loaded after it for the life of the
process. When mocking a module other code also depends on, assume the mock is permanent.

Integration tests need postgres/mysql/mssql reachable (ports `15432` / `13306` / `11433`).


## Changesets

This is a bun workspace monorepo with two publishable packages. Changeset frontmatter must reference the correct workspace package name:

- **`@noormdev/cli`** — `packages/cli` (CLI/TUI)
- **`@noormdev/sdk`** — `packages/sdk` (programmatic SDK)

Never use `noorm` or `@noormdev/main` — those are not workspace packages and will fail the Release workflow.

Changesets is the release engine because it supports a fixed-version group: `@noormdev/cli` and `@noormdev/sdk` are coupled packages that always bump together on every release, which fits a two-package monorepo where the packages version in lockstep rather than independently.


## Tech Stack

- **Kysely** - SQL query builder & executor
- **Eta** - Templating engine for dynamic SQL
- **Ink + React** - CLI interface
- **@logosdx/observer** - Event system
- **@logosdx/utils** - Error tuples, retry, batch utilities


## Structure

`src/core/` is business logic with no UI, `src/cli/` is Citty commands, `src/tui/` is the Ink app.
The per-domain path→purpose mapping lives in the Domains table of
[`docs/wiki/index.md`](docs/wiki/index.md), which is regenerated rather than hand-maintained.

Two placements the tree does not explain on its own:

- `src/workers/` sits *outside* `core/` — those files are standalone entry points compiled by
  `bun build --compile`, not modules imported by core (see Worker Threads above).
- `src/core/dt/` is the `.dt` binary serialization format, consumed by the SDK rather than the CLI.


## Development Rules

Path-specific rules are in `.claude/rules/`:

| File | Applies To | Covers |
|------|------------|--------|
| `typescript.md` | `**/*.{js,jsx,ts,tsx}` | 4-block function structure, error handling (no try-catch), imports, code style |
| `tui-development.md` | `src/tui/**`, `tests/tui/**` | Focus system, UI patterns, Ink layout, observer hooks |
| `testing.md` | `tests/**/*.{ts,tsx}` | Test naming, coverage, error assertions |
| `documentation.md` | `docs/**/*.md` | Three-pillar structure, style, tone |


## Help System

Help text is rendered by citty natively via `--help`. Each command file may attach an `examples: string[]` array to its `defineCommand` result; the `src/cli/index.ts` help interceptor appends an EXAMPLES block after citty's auto-generated usage.


## Worker Threads

CPU-bound work (DT serialization) and all DB operations run in worker threads via `WorkerBridge`, an
`ObserverRelay` subclass. Hub-and-spoke architecture and event contracts:
[`docs/wiki/worker-bridge.md`](docs/wiki/worker-bridge.md).

Worker scripts live at `src/workers/` (not inside `core/`) because they're standalone entry points
for `bun build --compile`.

**Never hardcode worker paths.** Use `resolveWorker(name)` from `src/core/worker-bridge/paths.ts`.
`bun build --compile` silently strips `src/`, rewrites `.ts`→`.js`, and resolves bare string paths
against CWD rather than the binary — so `src/workers/compute.ts` becomes
`/$bunfs/root/workers/compute.js`. The resolver handles dev mode and the compiled binary; a literal
path works in exactly one of them.

Diagnostic: `noorm dev test-workers` — runs 5 worker thread tests in any execution context.


## Principles

Use Kysely as the SQL translator. Write database operations once, Kysely handles dialect differences.

For setup wizards where the target database may not exist yet, use `testConnection(config, { testServerOnly: true })`. This connects to the dialect's system database (postgres→`postgres`, mssql→`master`, mysql→no database) to verify credentials without requiring the target database.


<atomic-signals>

## Project signals (auto-loaded)


@docs/wiki/index.md

</atomic-signals>
