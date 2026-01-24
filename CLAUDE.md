# CLAUDE.md


## Overview

**noorm** - Database Schema & Change Manager with Ink/React TUI.

Manage database configs, execute SQL changes, run templated SQL files. Core modules emit events via `@logosdx/observer`, CLI subscribes. Configs stored encrypted in `.noorm/state/state.enc`. Headless mode for CI/CD with JSON output.


## Commands

```bash
yarn build                      # Build project
yarn test                       # Run tests
yarn test:watch                 # Watch mode
yarn test:coverage              # With coverage
yarn dev                        # Development with ts-node
yarn lint                       # Lint
yarn typecheck                  # Type check
```


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
│   ├── change/              # Change parsing, execution
│   ├── runner/                 # SQL file execution
│   ├── lock/                   # Concurrent operation locking
│   ├── template/               # Eta templating
│   └── encryption/             # AES-256-GCM
│
├── cli/                        # Ink/React TUI
│   ├── screens/                # Screen components by feature
│   ├── components/             # Shared UI components
│   ├── hooks/                  # React hooks
│   ├── headless.ts             # CI/CD JSON output
│   └── help.ts                 # Help file registry
│
help/                           # CLI help files (plain text)
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


## Help Files

CLI help is stored in `help/*.txt` files. Plain text, terminal-friendly (not markdown).


### Architecture

```
help/                           # Help files directory
├── home.txt                    # Top-level commands
├── config.txt
├── config-add.txt              # Subcommands use dashes
├── config-edit.txt
├── db-explore-tables.txt       # Nested routes flatten to dashes
└── ...

src/cli/help.ts                 # Registry and lookup functions
```

**Registry:** Maps route paths to filenames. Not all routes need entries—hierarchical fallback finds parent help.

```typescript
const HELP_REGISTRY: Record<string, string> = {
    'home': 'home.txt',
    'config': 'config.txt',
    'config/add': 'config-add.txt',
    'db/explore/tables': 'db-explore-tables.txt',
    // ...
};
```


### Hierarchical Fallback

When help is requested, the system tries progressively shorter prefixes:

```
noorm help db explore tables detail users
  → tries: db/explore/tables/detail/users  (not found)
  → tries: db/explore/tables/detail        (not found)
  → tries: db/explore/tables               ✓ found → db-explore-tables.txt
```

This means parent help covers undocumented children automatically.


### API Functions

```typescript
import { getHelp, getHelpMatch, listHelpTopics } from './help.js';

// Load help content (async, returns null if not found)
const content = await getHelp('db/explore/tables');

// Get the matched route (useful for showing which help loaded)
const match = getHelpMatch('db/explore/tables/detail');  // → 'db/explore/tables'

// List all available topics
const topics = listHelpTopics();  // → ['change', 'change/ff', 'config', ...]
```


### File Format

```
COMMAND NAME - Brief description

USAGE
    noorm command [subcommand] [options]

SUBCOMMANDS
    sub1    Description
    sub2    Description

DESCRIPTION
    Detailed explanation of what the command does.

EXAMPLES
    noorm -H command sub1            Comment
    noorm -H --json command sub2     Comment

JSON OUTPUT (--json)
    { "example": "output" }

SEE ALSO
    noorm help related-command
```


### Adding New Help

1. Create `help/<route-with-dashes>.txt` following the format above
2. Add entry to `HELP_REGISTRY` in `src/cli/help.ts`
3. File naming: `config/use` → `config-use.txt`, `db/explore/tables` → `db-explore-tables.txt`

Only add registry entries for routes with dedicated content. Parent routes automatically cover children via fallback.


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
