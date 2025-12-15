# noorm - Database Schema & Changeset Manager


## Philosophy

- You always keep an up-to-date schema of current state
- You run changesets to update your schemas — which are done with, but the history doesn't matter
- To get started, you just run a build and it should create your DB from scratch


## Tech Stack

- **Kysely** - SQL query builder & executor (handles all dialect differences internally)
- **Eta** - Templating engine for dynamic SQL
- **Ink + React** - CLI interface


## Dialect Philosophy

**noorm does NOT abstract SQL dialects.** You write SQL for your target database.

Kysely handles:
- Connection management
- Query execution
- Transactions
- Internal tracking tables

You handle:
- Writing SQL in your dialect of choice
- Dialect-specific syntax in your schema/changeset files

This means:
- No leaky abstractions
- Full power of your database
- No "lowest common denominator" SQL
- Works with any Kysely-compatible database (Postgres, MySQL, SQLite, SQL Server, etc.)


## User Experience


### Entry Modes

```bash
$ noorm                       # Opens full TUI at home screen
$ noorm config                # Jumps directly to config section
$ noorm config add            # Jumps directly to config add screen
$ noorm -H config add         # Non-interactive (headless) for CI/scripts
```


### Navigation

Hybrid approach: Full TUI app with command-line entry points.

Main sections:
- **Config** - Database connection profiles (dev, staging, prod)
- **Settings** - Project-level build configuration
- **Change** - Changeset management (create, run, revert)
- **Run** - Execute SQL (build schema, run files/directories)
- **DB** - Database lifecycle (create, destroy)
- **Lock** - Concurrent operation management


### Headless Mode

For CI/CD environments:
- Triggered by `-H` flag or `CI=1` environment variable
- All parameters via flags or environment variables
- JSON output option with `--json`
- Exit codes for success/failure


## Project Structure

```
schema/                    # Always reflects "what the DB should look like now"
├── 001_users.sql
├── 002_posts.sql
└── 003_comments.sql

changesets/                # Modifications after initial build
└── 2024-01-15_add-email-verification/
    ├── change/
    │   ├── 001_alter_users.sql
    │   └── 002_create_tokens.sql
    └── revert/
        ├── 001_drop_tokens.sql
        └── 002_revert_users.sql

.noorm/                    # Local encrypted config storage
├── state.enc              # Encrypted configs, secrets, active config
└── settings.yml           # Version-controlled project settings
```


## Core Concepts


### Configs

Database connection profiles for different environments. Each config has:
- Connection details (host, port, database, credentials)
- Protection status (requires confirmation for dangerous operations)
- Test flag (for test databases)
- Per-config secrets


### Changesets

Dated folders containing SQL files to evolve your database:
- `change/` subfolder for forward migrations
- `revert/` subfolder for rollbacks
- History tracked: what ran, when, by whom, status


### Protected Configs

Production-like configs can be marked as protected:
- State-modifying operations require typing `yes-<config-name>`
- `db:destroy` is blocked entirely on protected configs


### Settings

Project-level configuration in `.noorm/settings.yml`:
- Build include/exclude patterns
- Stage-based rules (run/skip files based on environment)
- Custom paths for schema and changeset directories

See `plan/settings.md` for details.


### Identity

Tracks who executed operations:
1. Config override (explicit identity set)
2. Git user (`git config user.name`)
3. System user (OS username)


### Encryption

Local state encrypted with machine-derived key:
- Configs never leave the machine unencrypted
- Optional passphrase for shared environments
- AES-256-GCM authenticated encryption


### File Tracking

Files tracked by content hash (SHA-256):
- **new** - Not seen before → run
- **changed** - Different checksum → run
- **unchanged** - Same checksum → skip


### Lock Manager

Prevents concurrent operations on same database:
- Advisory locks or lock table (dialect-dependent)
- Auto-expire after timeout
- Manual release available


## Template Variables

Eta templates can access:
- `dialect` - Current database dialect
- `config` - Current config object
- `secrets` - Decrypted secrets
- `load()` - Load data files (JSON, YAML, CSV, JS)
- `include()` - Include raw SQL files


## Resolved Decisions

- [x] Project name: `noorm`
- [x] Schema auto-update: **No** - One way to do things. `build` creates from schema/, `change` evolves existing state.
- [x] Lock manager: **Yes** - Prevent concurrent operations on same database.
- [x] Seed data: **Part of schema** - Use Eta templates to load data files.


## Detailed Plans

Implementation details live in the `plan/` directory:
- `plan/changeset.md` - Changeset management
- `plan/cli/db.md` - Database lifecycle commands
- `plan/config.md` - Config management
- `plan/identity.md` - Identity resolution
- `plan/runner.md` - SQL execution
- `plan/settings.md` - Settings system
- `plan/state.md` - State persistence and encryption
- `plan/utils.md` - Observer, attempt, retry patterns
