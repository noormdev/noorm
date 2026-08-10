# CLAUDE.md


## Overview

**noorm** - Database Schema & Change Manager with Ink/React TUI.

Manage database configs, execute SQL changes, run templated SQL files. Core modules emit events via `@logosdx/observer`, CLI subscribes. Configs stored encrypted in `.noorm/state/state.enc`. Headless mode for CI/CD with JSON output.


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

A single `bun test` (whole suite, one process) does **not** reflect CI. CI deliberately splits the suite into five independent `bun test --serial` invocations, each in a fresh process — see `.github/workflows/ci.yml`:

1. `tests/utils` + `tests/core` (excluding `tests/core/transfer`) + `tests/sdk`
2. `tests/core/transfer` (isolated — comment cites a runner-image regression)
3. `tests/cli` (excluding `cli-logger-settings.test.ts`)
4. `tests/cli/cli-logger-settings.test.ts` (isolated — see below)
5. `tests/integration`

The split exists because cross-file pollution (module-scope `process.env` snapshots, shared DB state, singletons left dirty between files) produces hundreds of false failures in the unified run while CI is green. When triaging a "broken" test, **run the file in isolation first**; if it passes alone, the failure is contamination, not a regression.

**`mock.module` never restores.** Bun's mock registry is process-global, and re-registering the real module does *not* undo a mock — measured directly. Every `afterAll(() => mock.module(..., () => actualX))` in this repo is therefore a no-op, despite the "restore mocked modules to prevent pollution" comments next to them. A file that mocks a module poisons every file loaded after it for the life of the process.

That is what isolates group 4. Two init-screen tests replace the `SettingsManager` *class*; `getSettingsManager` then constructs a mock instance, so `createCliLogger` reads `settings: {}` instead of `settings.yml`. Which file wins depends on load order — root files before subdirectories on macOS, the reverse on Linux — so it passed locally and failed only on CI. When mocking a module other code also depends on, assume the mock is permanent.

The previously documented contamination source — `src/core/config/index.ts:34` calling `makeNestedConfig(process.env, …)` at module scope — **does not reproduce**: the call passes `memoizeOpts: false`, so lookups re-read `process.env` rather than snapshotting at import.

To reproduce CI locally, run the four invocations separately:

```bash
bun test --serial $(find tests/utils tests/core tests/sdk -name '*.test.ts' | grep -v tests/core/transfer | sort | tr '\n' ' ')
bun test --serial tests/core/transfer
bun test --serial $(find tests/cli \( -name '*.test.ts' -o -name '*.test.tsx' \) ! -name 'cli-logger-settings.test.ts' | sort | tr '\n' ' ')
bun test --serial tests/cli/cli-logger-settings.test.ts
bun test --serial tests/integration
```

The integration step needs postgres/mysql/mssql reachable (CI uses service containers on ports `15432` / `13306` / `11433`).


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

```
src/
├── core/                       # Business logic (no UI)
│   ├── observer.ts             # Central event system
│   ├── config/                 # Config management
│   ├── change/                 # Change parsing, execution
│   ├── runner/                 # SQL file execution
│   ├── lock/                   # Concurrent operation locking
│   ├── template/               # Eta templating
│   ├── encryption/             # AES-256-GCM
│   ├── worker-bridge/          # Worker thread infrastructure
│   │   ├── bridge.ts           # WorkerBridge (ObserverRelay subclass)
│   │   ├── pool.ts             # WorkerPool (round-robin dispatch)
│   │   ├── order-buffer.ts     # Index-ordered reassembly buffer
│   │   ├── paths.ts            # Cross-context worker path resolution
│   │   └── types.ts            # Event contracts, WireMessage, Correlated
│   └── dt/                     # Data transfer (.dt files)
│
├── workers/                    # Worker thread entry points (standalone programs)
│   ├── connection.ts           # Persistent DB worker (Kysely)
│   └── compute.ts              # Stateless serialize/deserialize
│
├── cli/                        # Citty CLI commands (per-domain subdirectories)
├── tui/                        # Ink/React TUI (launched via `noorm ui`)
│
tests/                          # Test suite
docs/                           # Documentation
skills/                         # Claude Code skill source files
```


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

CPU-bound operations (DT export/import serialization) run in worker threads via `WorkerBridge`, an `ObserverRelay` subclass from `@logosdx/observer`. Hub-and-spoke architecture:

- **Connection Worker** (`src/workers/connection.ts`) — persistent, owns Kysely, handles all DB ops
- **Compute Pool** (`src/workers/compute.ts`) — ephemeral N workers for serialize/deserialize
- **Main Thread** — orchestrates pipeline, writes files, emits progress events to TUI

Worker scripts live at `src/workers/` (not inside `core/`) because they're standalone entry points for `bun build --compile`.

Use `resolveWorker(name)` from `src/core/worker-bridge/paths.ts` to get worker paths. Never hardcode worker paths — the resolver handles dev mode (absolute path to `dist/workers/*.js`) and compiled binary (URL against `import.meta.url`).


### Bun Single Binary Worker Gotcha

When `bun build --compile` bundles worker entry points, three transformations happen silently:

1. **`src/` is stripped** — Bun auto-detects `src/` as `--root` and removes it from paths
2. **`.ts` → `.js`** — TypeScript files are compiled to JavaScript in the embedded graph
3. **Paths resolve against CWD** — bare string paths like `'src/workers/compute.ts'` resolve relative to the process's current working directory, not the binary

So `src/workers/compute.ts` in the build command becomes `/$bunfs/root/workers/compute.js` in the binary. To resolve correctly regardless of CWD, use `new URL('./workers/compute.js', import.meta.url)` — this resolves against the binary's own `$bunfs` URL.

The `resolveWorker()` function in `src/core/worker-bridge/paths.ts` handles this. Always use it.

Diagnostic command: `noorm dev test-workers` — runs 5 worker thread tests in any execution context.


## Principles

Use Kysely as the SQL translator. Write database operations once, Kysely handles dialect differences.

For setup wizards where the target database may not exist yet, use `testConnection(config, { testServerOnly: true })`. This connects to the dialect's system database (postgres→`postgres`, mssql→`master`, mysql→no database) to verify credentials without requiring the target database.


## Keyboard Shortcuts

Consistent hotkey conventions across all screens:

**Home navigation** (`src/tui/screens/home.tsx`):
| Key | Action |
|-----|--------|
| `r` | run |
| `c` | config |
| `g` | changes |
| `d` | db |
| `+` | more (settings, vault, identity, lock) |
| `s` | settings |
| `v` | vault |
| `i` | identity |
| `l` | lock |
| `u` | update |
| `1` / `2` / `3` | quick actions: run build, change ff, lock status |
| `q` | quit |

There is no `k` on Home — secrets belong to a config, so `k` opens them from
the config list.

**Common actions (sub-screens):**
| Key | Action | Mnemonic |
|-----|--------|----------|
| `a` | add | |
| `e` | edit | |
| `d` | delete | |
| `k` | secrets | **k**eys (from the config list) |
| `+` | more | export / import / validate live here, not on the list |
| `Enter` | use/activate | selecting a config activates it |

**Context-dependent keys:**
- `[i]` = identity on Home, import on the config More screen
- `[x]` = export on the config More screen, extend in Lock Status
- `[s]` = settings on Home, status in Lock List
- `[c]` = config on Home, copy on the config list, create on the DB screen

**Global shortcuts (available everywhere):**
| Key | Action |
|-----|--------|
| `Shift+L` | Toggle log viewer overlay |
| `Shift+Q` | Open the SQL terminal |
| `?` | Show help |

Use `numberNav` prop on `SelectList` for 1-9 quick selection in lists.

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

<atomic-signals>

## Project signals (auto-loaded)


@docs/wiki/index.md

</atomic-signals>
