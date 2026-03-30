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


## Changesets

This is a pnpm monorepo with two publishable packages. Changeset frontmatter must reference the correct workspace package name:

- **`@noormdev/cli`** — `packages/cli` (CLI/TUI)
- **`@noormdev/sdk`** — `packages/sdk` (programmatic SDK)

Never use `noorm` or `@noormdev/main` — those are not workspace packages and will fail the Release workflow.


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
├── cli/                        # Ink/React TUI
│   ├── screens/                # Screen components by feature
│   ├── components/             # Shared UI components
│   ├── hooks/                  # React hooks
│   └── headless/               # CI/CD JSON output
│
tests/                          # Test suite
docs/                           # Documentation
```


## Development Rules

Path-specific rules are in `.claude/rules/`:

| File | Applies To | Covers |
|------|------------|--------|
| `typescript.md` | `**/*.{js,jsx,ts,tsx}` | 4-block function structure, error handling (no try-catch), imports, code style |
| `tui-development.md` | `src/cli/**`, `tests/cli/**` | Focus system, UI patterns, Ink layout, observer hooks |
| `testing.md` | `tests/**/*.{ts,tsx}` | Test naming, coverage, error assertions |
| `documentation.md` | `docs/**/*.md` | Three-pillar structure, style, tone |


## Help System

Help text lives as `export const help` markdown strings in each headless module (`src/cli/headless/*.ts`). The `formatHelp()` function in `src/core/help-formatter.ts` renders markdown syntax (headings, code blocks, inline code, bold, etc.) with terminal colors.

`noorm help <topic>` resolves the route to a handler in the HANDLERS registry (`src/cli/headless/index.ts`) and displays its `.help` property. `home.ts` provides the root help text shown when no topic is specified.

To add or update help for a command, edit the `export const help` template literal in that command's headless module. The help formatter supports `#`/`##`/`###` headings, code blocks, `> blockquotes`, `**bold**`, `*italic*`, `` `inline code` ``, `[optional]` args, `<required>` args, and `NAME` placeholders.


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

Diagnostic command: `noorm -H dev/test-workers` — runs 5 worker thread tests in any execution context.


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
