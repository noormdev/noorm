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

**Home navigation:**
| Key | Action |
|-----|--------|
| `c` | config |
| `g` | changes |
| `r` | run |
| `d` | db |
| `l` | lock |
| `s` | settings |
| `k` | secrets (keys) |
| `i` | identity |
| `q` | quit |

**Common actions (sub-screens):**
| Key | Action | Mnemonic |
|-----|--------|----------|
| `a` | add | |
| `e` | edit | |
| `d` | delete | |
| `x` | export | e**x**port |
| `i` | import | |
| `u` | use/activate | |
| `v` | validate | |
| `k` | secrets | **k**eys |

**Context-dependent keys:**
- `[i]` = identity on Home, import in sub-screens
- `[x]` = export where applicable, extend in Lock Status
- `[s]` = settings on Home, status in Lock List

**Global shortcuts (available everywhere):**
| Key | Action |
|-----|--------|
| `Shift+L` | Toggle log viewer overlay |

Use `numberNav` prop on `SelectList` for 1-9 quick selection in lists.

<atomic-signals>

## Project signals (auto-loaded)


@docs/wiki/index.md

</atomic-signals>
