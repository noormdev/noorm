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


<<<<<<< HEAD
## Documentation surfaces

| Path | Covers | Voice |
|------|--------|-------|
| `README.md` | project overview, install, quick start | atomic-writing |
| `docs/index.md` | docs landing, why noorm, quick start | atomic-writing |
| `docs/why-noorm.md` | rationale, prior tools, history | atomic-writing |
| `docs/tui.md` | TUI screens, navigation, keyboard shortcuts | terse-technical |
| `docs/headless.md` | CLI reference, global flags, command discovery | terse-technical |
| `docs/getting-started/installation.md` | requirements, CLI install, SDK install | atomic-writing |
| `docs/getting-started/concepts.md` | SQL files as source of truth, execution order, changes | atomic-writing |
| `docs/getting-started/first-build.md` | init, first build walkthrough | atomic-writing |
| `docs/getting-started/building-your-sdk.md` | monorepo setup, database package, SDK wiring | atomic-writing |
| `docs/guide/automation/ci.md` | test CI, prod CI shapes | atomic-writing |
| `docs/guide/automation/mcp.md` | MCP server, AI agent integration, tools | atomic-writing |
| `docs/guide/automation/non-interactive.md` | --yes semantics, CI bootstrap | atomic-writing |
| `docs/guide/changes/overview.md` | changes vs migrations, directory structure | atomic-writing |
| `docs/guide/changes/forward-revert.md` | apply and revert lifecycle | atomic-writing |
| `docs/guide/changes/history.md` | execution history, TUI history views | atomic-writing |
| `docs/guide/database/create.md` | db create, configs-first workflow | atomic-writing |
| `docs/guide/database/explore.md` | schema explorer screens | atomic-writing |
| `docs/guide/database/teardown.md` | truncate, teardown operations | atomic-writing |
| `docs/guide/database/terminal.md` | SQL terminal usage | atomic-writing |
| `docs/guide/database/transfer.md` | cross-database transfer | atomic-writing |
| `docs/guide/deployment.md` | deploy split, runtime connection, one context per process | atomic-writing |
| `docs/guide/environments/configs.md` | multiple configs, creating configs | atomic-writing |
| `docs/guide/environments/stages.md` | stages | atomic-writing |
| `docs/guide/environments/secrets.md` | secrets, config-scoped vs global | atomic-writing |
| `docs/guide/environments/vault.md` | vault, secret resolution, encryption | atomic-writing |
| `docs/guide/relational-design.md` | inherited keys, basetype-subtype modeling | atomic-writing |
| `docs/guide/sql-files/organization.md` | directory structure, naming, execution order | atomic-writing |
| `docs/guide/sql-files/execution.md` | run build, run file, execution | atomic-writing |
| `docs/guide/sql-files/templates.md` | Eta template syntax, rendering context | atomic-writing |
| `docs/guide/troubleshooting.md` | common failure modes, flag gotchas | atomic-writing |
| `docs/cli/flags.md` | global vs per-subcommand flags, --config overload | terse-technical |
| `docs/cli/help.md` | help discovery | terse-technical |
| `docs/cli/identity.md` | identity management commands | terse-technical |
| `docs/cli/init.md` | noorm init | terse-technical |
| `docs/cli/run.md` | noorm run subcommands, exit codes | terse-technical |
| `docs/cli/secret.md` | noorm secret | terse-technical |
| `docs/cli/settings-edit.md` | noorm settings edit | terse-technical |
| `docs/cli/settings-secret.md` | noorm settings secret | terse-technical |
| `docs/cli/sql.md` | noorm sql | terse-technical |
| `docs/cli/sql-repl.md` | noorm sql repl | terse-technical |
| `docs/dev/index.md` | developer docs index | terse-technical |
| `docs/dev/sdk.md` | SDK developer guide, createContext, withSchema, routines, events | atomic-writing |
| `docs/dev/change.md` | change parsing, execution internals | atomic-writing |
| `docs/dev/runner.md` | runner, checksum change detection | atomic-writing |
| `docs/dev/template.md` | Eta templating internals | atomic-writing |
| `docs/dev/config.md` | config sources, structure | atomic-writing |
| `docs/dev/config-sharing.md` | config export and import | atomic-writing |
| `docs/dev/settings.md` | settings.yml | atomic-writing |
| `docs/dev/state.md` | encrypted state | atomic-writing |
| `docs/dev/identity.md` | audit and cryptographic identity | atomic-writing |
| `docs/dev/secrets.md` | secret tiers | atomic-writing |
| `docs/dev/vault.md` | vault architecture, encryption | atomic-writing |
| `docs/dev/logger.md` | structured logger | atomic-writing |
| `docs/dev/explore.md` | schema exploration internals | atomic-writing |
| `docs/dev/teardown.md` | truncate and teardown internals | atomic-writing |
| `docs/dev/transfer.md` | data transfer, DT format | atomic-writing |
| `docs/dev/sql-terminal.md` | SQL terminal internals | atomic-writing |
| `docs/dev/lock.md` | operation locking | atomic-writing |
| `docs/dev/ci.md` | CI/CD integration, exit codes | atomic-writing |
| `docs/dev/headless.md` | CLI architecture, headless flags | terse-technical |
| `docs/dev/project-discovery.md` | project root discovery | atomic-writing |
| `docs/dev/datamodel.md` | data model ERD, entities | terse-technical |
| `docs/dev/version.md` | version layers, migration | atomic-writing |
| `docs/dev/ink-cheatsheet.md` | Ink API cheatsheet | terse-technical |
| `docs/dev/ink-testing-library-cheatsheet.md` | ink-testing-library cheatsheet | terse-technical |
| `docs/modeling/index.md` | ignatius overview, IDEF1X modeling | atomic-writing |
| `docs/modeling/installation.md` | ignatius install | atomic-writing |
| `docs/modeling/entities.md` | entity format, key inheritance | atomic-writing |
| `docs/modeling/data-flows.md` | SSADM data flow diagrams | atomic-writing |
| `docs/modeling/best-practices.md` | modeling best practices | atomic-writing |
| `docs/modeling/branding.md` | model branding | atomic-writing |
| `docs/modeling/modeling-skill.md` | /noorm-modeling skill | atomic-writing |
| `docs/modeling/reverse-engineering.md` | reverse-engineering via MCP | atomic-writing |
| `docs/reference/sdk.md` | SDK API reference, withSchema, impersonation, routines | terse-technical |
| `packages/sdk/README.md` | npm SDK readme, install, usage, schema scoping | terse-technical |

=======
>>>>>>> origin/master
<atomic-signals>

## Project signals (auto-loaded)


@docs/wiki/index.md

</atomic-signals>
