# NoORM CLI Reference

Headless mode for CI/CD pipelines, scripting, and database management.

## Table of Contents

1. [Activation](#activation)
2. [Global Flags](#global-flags)
3. [Environment Variables](#environment-variables)
4. [Commands](#commands)
5. [CI/CD Examples](#cicd-examples)
6. [Scripting Patterns](#scripting-patterns)

---

## Activation

Every `noorm` subcommand is non-interactive by default — it prints output to stdout/stderr and exits. The only exceptions are explicitly interactive commands (`noorm init`, `noorm sql repl`, `noorm settings edit`, `noorm settings secret`, `noorm identity init`), which require a TTY.

To launch the interactive terminal UI, run:

```bash
noorm ui
```

The TUI is the only subcommand that renders the Ink/React interface; every other command is scripting-friendly.

## Global Flags

| Flag | Short | Description |
|---|---|---|
| `--json` | — | Output structured JSON instead of human-readable text |
| `--config` | `-c` | Config name to use |
| `--force` | `-f` | Skip checksum and protection checks |
| `--yes` | `-y` | Skip interactive confirmations |
| `--dry-run` | — | Preview what would happen without executing |

## Environment Variables

### Connection

```bash
NOORM_CONNECTION_DIALECT     # postgres, mysql, sqlite, mssql (required for env-only mode)
NOORM_CONNECTION_HOST        # Database host
NOORM_CONNECTION_PORT        # Database port
NOORM_CONNECTION_DATABASE    # Database name (required for env-only mode)
NOORM_CONNECTION_USER        # Username
NOORM_CONNECTION_PASSWORD    # Password
```

### Paths

```bash
NOORM_PATHS_SQL              # Schema directory (default: ./sql)
NOORM_PATHS_CHANGES          # Changes directory (default: ./changes)
```

### Behavior

```bash
NOORM_CONFIG                 # Config name to use (alternative to --config flag)
NOORM_YES                    # Skip confirmations: 1 or true
NOORM_JSON                   # Force JSON output: 1 or true
NOORM_HEADLESS               # Signal CI mode (routes logs to stdout; detected automatically in CI)
NOORM_DEBUG                  # Enable debug logging
```

**Nesting convention:** underscores map to object depth after stripping the `NOORM_` prefix. `NOORM_CONNECTION_HOST` becomes `connection.host`. Numbers and booleans are auto-converted; password fields stay as strings.

**Priority:** CLI flags > env vars > stored config > stage defaults (settings.yml) > hard-coded defaults.

## Commands

### init

Bootstrap a new noorm project interactively. Creates identity (if needed), project structure (`sql/`, `changes/`, `.noorm/`), `settings.yml`, and encrypted `state.enc`.

```bash
noorm init              # Interactive — requires TTY
noorm init --force      # Reinitialize an existing .noorm/
```

**TTY required.** Fails with exit code 1 in CI or when stdin is piped.

---

### config use

Set the active configuration.

```bash
noorm config use dev
noorm --json config use production
```

**JSON:** `{ "activeConfig": "production" }`

---

### identity init

Create a new cryptographic identity. Generates an X25519 keypair and stores it at `~/.noorm/identity.{key,pub,json}`. Required before using config sharing or team discovery features.

```bash
noorm identity init --name "Alice" --email "alice@example.com"
noorm identity init --name "Alice" --email "alice@example.com" --force
noorm --json identity init --name "Alice" --email "alice@example.com"
```

**JSON:** `{ "name": "Alice", "email": "alice@example.com", "fingerprint": "...", "publicKey": "..." }`

### identity edit

Update the display name or email on the existing identity. At least one of `--name` or `--email` must be provided.

```bash
noorm identity edit --name "Alice Cooper"
noorm identity edit --email "alice@newjob.com"
```

### identity export

Print your public key so teammates can add you to encrypted vaults.

```bash
noorm identity export
noorm --json identity export
```

### identity list

List all known users discovered from database syncs (the audit trail of who has touched shared state).

```bash
noorm identity list
noorm --json identity list
```

### identity ci

Validate a CI-loaded identity from environment variables. Diagnostic only — the real bootstrap happens automatically at process startup when `NOORM_IDENTITY_PRIVATE_KEY`, `NOORM_IDENTITY_NAME`, and `NOORM_IDENTITY_EMAIL` are set. Exits 1 if any var is missing or malformed.

```bash
NOORM_IDENTITY_PRIVATE_KEY=abc... \
NOORM_IDENTITY_NAME="CI Bot" \
NOORM_IDENTITY_EMAIL="ci@example.com" \
noorm identity ci

noorm --json identity ci
```

**JSON:** `{ "name": "...", "email": "...", "publicKey": "...", "fingerprint": "...", "source": "env" }`

---

### settings init

Initialize `settings.yml` in the project root with defaults. Settings define project-wide paths, build rules, strict mode, logging, stages, validation rules, and teardown behavior.

```bash
noorm settings init
noorm settings init --force   # Overwrite existing
```

### settings build

Reload `settings.yml` and re-save it. Applies any missing defaults and normalizes formatting — useful after manual edits or upgrading noorm.

```bash
noorm settings build
```

### settings edit

Interactive editor for all seven settings sections: paths, build, strict, logging, stages, rules, teardown. Pick a section, edit it, return to the picker. Cancelling inside a sub-editor returns to the picker without killing the process.

```bash
noorm settings edit      # Requires TTY
```

### settings secret

Interactive editor for secret **requirement declarations** — which secrets are required for each stage, not the secret values themselves. (Values live in `noorm vault` / `noorm secret`.) Supports add, edit, remove, list for universal and stage-scoped requirements.

```bash
noorm settings secret    # Requires TTY
```

---

### run build

Execute all SQL files in the schema directory. Uses checksums to skip unchanged files.

```bash
noorm run build
noorm --force run build     # Skip checksums, rebuild everything
noorm --dry-run run build   # Preview without executing
```

**JSON:**

```json
{
    "status": "success",
    "filesRun": 2,
    "filesSkipped": 1,
    "filesFailed": 0,
    "durationMs": 234
}
```

### run file

Execute a single SQL or `.sql.tmpl` file.

```bash
noorm run file sql/01_tables/001_users.sql
noorm run file seed.sql.tmpl
noorm --json run file sql/init.sql
```

**JSON:** `{ "filepath": "seed.sql", "status": "success", "durationMs": 45 }`

Status is `"success"` or `"skipped"` (unchanged checksum).

### run dir

Execute all SQL files in a directory in alphabetical order.

```bash
noorm run dir sql/01_tables/
noorm run dir seeds/
```

### run inspect

Show the template context for a `.sql.tmpl` file without rendering it. Lists available data files, helpers, built-in functions, config keys, and secret counts.

```bash
noorm run inspect sql/users/001_create.sql.tmpl
noorm --json run inspect sql/core/Crons.sql.tmpl
```

**JSON:**

```json
{
    "filepath": "sql/users/001_create.sql.tmpl",
    "context": {
        "dataFiles": [{ "key": "roles", "type": "Array [3]" }],
        "helpers": [{ "key": "padId", "type": "Function" }],
        "helperErrors": [],
        "builtins": ["quote", "escape", "uuid", "now", "json", "include"],
        "configKeys": ["name", "connection"],
        "secretCount": 2,
        "globalSecretCount": 0
    }
}
```

### run preview

Render a `.sql.tmpl` file and output the resulting SQL. Does **not** execute against the database.

```bash
noorm run preview sql/schema.sql.tmpl              # Raw SQL to stdout
noorm run preview sql/schema.sql.tmpl > rendered.sql # Pipe to file
noorm --json run preview sql/seed.sql.tmpl           # JSON envelope
noorm --config staging run preview sql/migrations/002.sql.tmpl
```

**JSON:** `{ "filepath": "...", "sql": "CREATE TABLE ...", "durationMs": 12 }`

---

### change

Bare `noorm change` renders help — it no longer connects to the database. Use `noorm change list` for the status table.

**Interactive prompts:** every `change <subcommand> <name>` command makes the positional `<name>` optional on a TTY. When omitted, an interactive picker lists candidate changes and you select one. On a non-TTY (CI, piped stdin) the name is required and the command exits 1 with `Change name required…`. User cancellation exits 1 with `Cancelled.`.

Pickers filter their list to whatever the command can act on:

| Command | TTY picker lists |
|---------|------------------|
| `change edit` | every folder in `changes/` |
| `change add` | — (prompts for free-form description via `p.text`) |
| `change rm` | every folder in `changes/` |
| `change run` | pending / reverted changes |
| `change revert` | successfully applied changes |
| `change rewind` | successfully applied changes |
| `change history-detail` | changes with execution history (`status !== 'pending'`) |

### change list

List every known change with its status (pending, success, failed, reverted, stale).

```bash
noorm change list
noorm --json change list
noorm -c staging change list
```

**JSON:** `[{ "name": "2024-01-15-init", "status": "success" }, ...]`

### change ff

Fast-forward: apply all pending changes in order.

```bash
noorm change ff
noorm --dry-run change ff   # Preview only
noorm --force change ff     # Skip checksum checks
```

**JSON:**

```json
{
    "status": "success",
    "executed": 2,
    "skipped": 0,
    "failed": 0,
    "changes": [
        { "name": "2024-02-01-notifications", "status": "success", "durationMs": 45 }
    ]
}
```

### change next

Apply the next pending change only (rather than all of them).

```bash
noorm change next
noorm --json change next
```

Useful when you want to apply changes one at a time and verify each before continuing.

### change run

Apply a specific change by name. Omit the name on a TTY to pick from pending / reverted changes.

```bash
noorm change run                             # Interactive picker
noorm change run 2024-02-01-notifications
noorm --json change run 001_init
noorm -c staging change run 001_init
```

**JSON:**

```json
{
    "name": "2024-02-01-notifications",
    "direction": "change",
    "status": "success",
    "files": [
        { "filepath": "change/001_create-table.sql", "checksum": "a1b2c3", "status": "executed", "durationMs": 23 }
    ],
    "durationMs": 45
}
```

### change revert

Revert a previously applied change by running its rollback SQL. Omit the name on a TTY to pick from successfully applied changes.

```bash
noorm change revert                          # Interactive picker
noorm change revert 2024-02-01-notifications
noorm --json change revert 002_users
```

### change rewind

Revert applied changes back to (and including) a named change — the inverse of `change ff`. Omit the name on a TTY to pick from successfully applied changes.

```bash
noorm change rewind                          # Interactive picker
noorm change rewind 001_init
noorm change rewind 002_users --dry-run
noorm --json change rewind 003_roles
```

### change add

Scaffold a new change folder. Omit the description on a TTY to prompt for it. Offline — no DB connection required.

```bash
noorm change add                             # Prompts for description
noorm change add add-users-table
noorm change add create-audit-log --json
```

**JSON:** `{ "name": "2024-04-17-add-users-table", "path": "/project/changes/2024-04-17-add-users-table" }`

### change edit

Open a change folder in `$EDITOR` (falling back to `$VISUAL`, then `code`). stdio is inherited so terminal editors (vim, nano, emacs -nw) take over the terminal in-place; exits with the editor's own exit code. Offline — no DB connection required.

```bash
noorm change edit                            # Pick from all changes
noorm change edit 2024-04-17-add-users-table
EDITOR=vim noorm change edit 2024-04-17-add-users-table
```

### change rm

Delete a change folder. Omit the name on a TTY to pick from the list; a `p.confirm` prompt replaces `--yes` in interactive mode. On a non-TTY both the name **and** `--yes` are required so CI never deletes silently.

```bash
noorm change rm                              # Pick + confirm interactively
noorm change rm 2024-01-15-add-users-table   # Confirm interactively
noorm change rm 2024-01-15-add-users-table --yes   # CI-safe, no prompt
```

**JSON:** `{ "name": "2024-01-15-add-users-table", "deleted": true }`

### change history

View execution history with timestamps, direction, duration, and identity.

```bash
noorm change history
noorm --count 50 change history
noorm --json change history
```

**JSON:**

```json
[
    {
        "id": 1,
        "name": "001_init",
        "direction": "change",
        "status": "success",
        "executedAt": "2024-01-15T10:30:00Z",
        "executedBy": "Alice <alice@example.com>",
        "durationMs": 45,
        "errorMessage": null,
        "checksum": "abc123def456"
    }
]
```

### change history-detail

Per-file execution history for a specific change — every operation record plus each SQL file's status, duration, and error/skip reason. Omit the name on a TTY to pick from changes that have a history record.

```bash
noorm change history-detail                  # Interactive picker
noorm change history-detail 001_init
noorm change history-detail 003_roles --count 5
noorm --json change history-detail 002_users
```

---

### db explore

Database schema inspection.

```bash
noorm db explore                        # Overview counts
noorm db explore tables                 # List all tables
noorm db explore tables detail users    # Describe specific table
noorm --json db explore                 # JSON overview
```

**JSON (overview):** `{ "tables": 12, "views": 3, "indexes": 8, "functions": 2, "procedures": 0 }`

**JSON (table detail):**

```json
{
    "name": "users",
    "columns": [
        { "name": "id", "type": "integer", "nullable": false, "primaryKey": true },
        { "name": "email", "type": "varchar(255)", "nullable": false }
    ]
}
```

### db truncate

Wipe all data from application tables. Schema and noorm tracking tables are preserved.

```bash
noorm -y db truncate
```

### db teardown

Drop all database objects. **Blocked on protected configs** unless `--force` is used.

```bash
noorm -y db teardown
noorm --force db teardown   # Override protection
```

### db transfer

Three modes: database-to-database, export to `.dt` files, import from `.dt` files.

```bash
# Database-to-database
noorm db transfer --to backup
noorm db transfer --to backup --tables users,posts
noorm db transfer --to backup --on-conflict update
noorm db transfer --to backup --truncate
noorm db transfer --to backup --dry-run

# Export to files
noorm db transfer --export ./backup/                      # All tables, plain .dt
noorm db transfer --export ./backup/ --compress           # Compressed .dtz
noorm db transfer --export ./backup/ --passphrase secret  # Encrypted .dtzx
noorm db transfer --export ./backup/users.dt --tables users

# Import from files
noorm db transfer --import ./backup/users.dtz
noorm db transfer --import ./backup/users.dtzx --passphrase secret --on-conflict skip
```

**Transfer flags:**

| Flag | Description |
|---|---|
| `--to CONFIG` | Destination config (db-to-db mode) |
| `--export PATH` | Export path: file or directory |
| `--import PATH` | Import from `.dt`/`.dtz`/`.dtzx` file |
| `--compress` | Compress export as `.dtz` |
| `--passphrase TEXT` | Passphrase for `.dtzx` encryption/decryption |
| `--tables LIST` | Comma-separated table list (default: all) |
| `--on-conflict STRATEGY` | `fail`, `skip`, `update`, or `replace` (default: `fail`) |
| `--batch-size N` | Rows per batch for cross-server transfers (default: 1000) |
| `--truncate` | Truncate destination tables before transfer |
| `--no-fk` | Do not disable foreign key checks |
| `--no-identity` | Do not preserve identity/auto-increment values |
| `--dry-run` | Show transfer plan without executing |

---

### lock

Tool-level mutual exclusion managed by noorm (not database engine locks). Any noorm user targeting the same database will be blocked by this lock. Prevents concurrent schema migrations across noorm instances or CI runners.

```bash
noorm lock status    # Check if locked
noorm lock acquire   # Acquire lock
noorm lock release   # Release lock
noorm lock force     # Force-release any lock (emergency)
```

**JSON (lock status):**

```json
{
    "isLocked": true,
    "lock": {
        "lockedBy": "deploy@ci-runner",
        "lockedAt": "2024-01-15T10:30:00Z",
        "expiresAt": "2024-01-15T10:35:00Z"
    }
}
```

**CI/CD pattern with cleanup:**

```bash
noorm lock acquire
trap "noorm lock release" EXIT
noorm change ff
```

---

### vault

Team-shared encrypted secrets stored in the database.

```bash
noorm vault init                                # Initialize vault
noorm vault set API_KEY "sk-live-abc123"        # Store a secret
noorm vault list                                # List secret keys (values hidden)
noorm vault rm OLD_KEY                          # Remove a secret
noorm vault cp API_KEY staging production       # Copy between configs
noorm vault cp --all staging production         # Copy all secrets
noorm vault cp --all --force staging production # Overwrite existing
noorm vault propagate                           # Grant access to new team members
```

---

### sql

Execute raw SQL queries directly.

```bash
noorm sql "SELECT * FROM users LIMIT 10"
noorm sql -f query.sql                   # Read from file
noorm -c prod sql "SELECT count(*) FROM orders"
noorm --json sql "SELECT id, name FROM users"
```

**JSON:**

```json
{
    "success": true,
    "columns": ["id", "name"],
    "rows": [
        { "id": 1, "name": "Alice" },
        { "id": 2, "name": "Bob" }
    ],
    "rowsAffected": null,
    "durationMs": 12.5
}
```

### sql repl

Launch the TUI directly on the SQL Terminal screen: multi-line editing, sortable result tables, history navigation.

```bash
noorm sql repl
noorm sql repl --config dev
```

**TTY required.** Fails with exit code 1 in CI or when stdin is piped.

### sql history

Show recent SQL execution history for a config. Reads persisted history from `.noorm/state/history/`; no database connection required.

```bash
noorm sql history
noorm sql history -n 20
noorm --json sql history
noorm -c prod sql history
```

### sql clear

Clear SQL execution history for a config. Supports clearing all entries or only those older than N months.

```bash
noorm sql clear --yes
noorm sql clear --older-than 3 --yes
noorm -c prod sql clear --yes
```

---

### info

Project and database status overview.

```bash
noorm info
noorm --json info
```

Surfaces: CLI version, schema versions, active config, connection details, identity, database object counts.

### version

CLI version and diagnostic information.

```bash
noorm version
noorm --json version
```

### help

Show help for any command.

```bash
noorm help
noorm help config use
noorm help change ff
```

---

## CI/CD Examples

### GitHub Actions

```yaml
name: Database Migrations
on:
  push:
    branches: [main]

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install noorm
        run: npm install -g @noormdev/cli
      - name: Apply schema and changes
        env:
          NOORM_CONNECTION_DIALECT: postgres
          NOORM_CONNECTION_HOST: ${{ secrets.DB_HOST }}
          NOORM_CONNECTION_DATABASE: ${{ secrets.DB_NAME }}
          NOORM_CONNECTION_USER: ${{ secrets.DB_USER }}
          NOORM_CONNECTION_PASSWORD: ${{ secrets.DB_PASSWORD }}
        run: |
          noorm run build
          noorm change ff
```

### Test Database Setup (GitHub Actions)

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test_db
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm install -g @noormdev/cli
      - name: Setup test database
        env:
          NOORM_CONNECTION_DIALECT: postgres
          NOORM_CONNECTION_HOST: localhost
          NOORM_CONNECTION_DATABASE: test_db
          NOORM_CONNECTION_USER: postgres
          NOORM_CONNECTION_PASSWORD: test
        run: |
          noorm run build
          noorm change ff
      - run: npm test
```

### GitLab CI

```yaml
migrate:
  stage: deploy
  image: node:22
  script:
    - npm install -g @noormdev/cli
    - noorm run build
    - noorm change ff
  variables:
    NOORM_CONNECTION_DIALECT: postgres
    NOORM_CONNECTION_HOST: $DB_HOST
    NOORM_CONNECTION_DATABASE: $DB_NAME
    NOORM_CONNECTION_USER: $DB_USER
    NOORM_CONNECTION_PASSWORD: $DB_PASSWORD
```

### Generic CI Script with Locking

```bash
#!/bin/bash
set -e

export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_HOST=$DB_HOST
export NOORM_CONNECTION_DATABASE=$DB_NAME
export NOORM_CONNECTION_USER=$DB_USER
export NOORM_CONNECTION_PASSWORD=$DB_PASSWORD

# Acquire lock to prevent concurrent migrations
noorm lock acquire
trap "noorm lock release" EXIT

# Build schema and apply changes
noorm run build
noorm change ff

# Verify
noorm --json db explore
```

## Scripting Patterns

### Check for pending changes before deploying

```bash
pending=$(noorm --json change | jq '[.[] | select(.status == "pending")] | length')
if [ "$pending" -gt 0 ]; then
    echo "Found $pending pending changes"
    noorm change ff
fi
```

### Verify table count after migration

```bash
tables=$(noorm --json db explore | jq '.tables')
echo "Database has $tables tables"
```

### Check for failures in change history

```bash
failures=$(noorm --json change history | jq '[.[] | select(.status == "failed")] | length')
if [ "$failures" -gt 0 ]; then
    echo "WARNING: $failures failed changes in history"
    exit 1
fi
```

### Render template and pipe to external tool

```bash
noorm run preview sql/hotfix.sql.tmpl | psql -h localhost -d myapp
```

### Check template context before rendering

```bash
files=$(noorm --json run inspect sql/seed.sql.tmpl | jq '.context.dataFiles | length')
echo "Template has $files data files available"
```

### Check vault access and propagate if needed

```bash
pending=$(noorm --json vault list | jq '.status.usersWithoutAccess')
if [ "$pending" -gt 0 ]; then
    noorm vault propagate
fi
```

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (check stderr or `--json` output) |
