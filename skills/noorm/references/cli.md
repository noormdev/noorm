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

Headless mode activates automatically when any of these conditions are met:

| Condition | Headless? |
|---|---|
| `-H` or `--headless` flag | Yes |
| `NOORM_HEADLESS=true` env var | Yes |
| CI environment detected | Yes |
| No TTY (piped output) | Yes |
| `-T` or `--tui` flag | No (forces interactive TUI) |

Detected CI environments: GitHub Actions (`GITHUB_ACTIONS`), GitLab CI (`GITLAB_CI`), CircleCI, Travis CI, Jenkins, Buildkite, generic (`CI` env var).

## Global Flags

| Flag | Short | Description |
|---|---|---|
| `--headless` | `-H` | Force headless mode |
| `--tui` | `-T` | Force TUI mode (overrides headless detection) |
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
NOORM_HEADLESS               # Force headless mode
NOORM_DEBUG                  # Enable debug logging
```

**Nesting convention:** underscores map to object depth after stripping the `NOORM_` prefix. `NOORM_CONNECTION_HOST` becomes `connection.host`. Numbers and booleans are auto-converted; password fields stay as strings.

**Priority:** CLI flags > env vars > settings file > config defaults.

## Commands

### config use

Set the active configuration.

```bash
noorm -H config use dev
noorm -H --json config use production
```

**JSON:** `{ "activeConfig": "production" }`

---

### run build

Execute all SQL files in the schema directory. Uses checksums to skip unchanged files.

```bash
noorm -H run build
noorm -H --force run build     # Skip checksums, rebuild everything
noorm -H --dry-run run build   # Preview without executing
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
noorm -H run file sql/01_tables/001_users.sql
noorm -H run file seed.sql.tmpl
noorm -H --json run file sql/init.sql
```

**JSON:** `{ "filepath": "seed.sql", "status": "success", "durationMs": 45 }`

Status is `"success"` or `"skipped"` (unchanged checksum).

### run dir

Execute all SQL files in a directory in alphabetical order.

```bash
noorm -H run dir sql/01_tables/
noorm -H run dir seeds/
```

### run inspect

Show the template context for a `.sql.tmpl` file without rendering it. Lists available data files, helpers, built-in functions, config keys, and secret counts.

```bash
noorm -H run inspect sql/users/001_create.sql.tmpl
noorm -H --json run inspect sql/core/Crons.sql.tmpl
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
noorm -H run preview sql/schema.sql.tmpl              # Raw SQL to stdout
noorm -H run preview sql/schema.sql.tmpl > rendered.sql # Pipe to file
noorm -H --json run preview sql/seed.sql.tmpl           # JSON envelope
noorm -H --config staging run preview sql/migrations/002.sql.tmpl
```

**JSON:** `{ "filepath": "...", "sql": "CREATE TABLE ...", "durationMs": 12 }`

---

### change

List all changes with their status (pending, applied, failed).

```bash
noorm -H change
noorm -H --json change
```

**JSON:** `[{ "name": "2024-01-15-init", "status": "applied" }, ...]`

### change ff

Fast-forward: apply all pending changes in order.

```bash
noorm -H change ff
noorm -H --dry-run change ff   # Preview only
noorm -H --force change ff     # Skip checksum checks
```

**JSON:**

```json
{
    "status": "success",
    "applied": 2,
    "skipped": 0,
    "failed": 0,
    "changes": [
        { "name": "2024-02-01-notifications", "status": "success", "durationMs": 45 }
    ]
}
```

### change run

Apply a specific change by name.

```bash
noorm -H change run 2024-02-01-notifications
noorm -H --json change run 001_init
noorm -H -c staging change run 001_init
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

Revert a previously applied change by running its rollback SQL.

```bash
noorm -H change revert 2024-02-01-notifications
noorm -H --json change revert 002_users
```

### change history

View execution history with timestamps, direction, duration, and identity.

```bash
noorm -H change history
noorm -H --count 50 change history
noorm -H --json change history
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

---

### db explore

Database schema inspection.

```bash
noorm -H db explore                        # Overview counts
noorm -H db explore tables                 # List all tables
noorm -H db explore tables detail users    # Describe specific table
noorm -H --json db explore                 # JSON overview
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
noorm -H -y db truncate
```

### db teardown

Drop all database objects. **Blocked on protected configs** unless `--force` is used.

```bash
noorm -H -y db teardown
noorm -H --force db teardown   # Override protection
```

### db transfer

Three modes: database-to-database, export to `.dt` files, import from `.dt` files.

```bash
# Database-to-database
noorm -H db transfer --to backup
noorm -H db transfer --to backup --tables users,posts
noorm -H db transfer --to backup --on-conflict update
noorm -H db transfer --to backup --truncate
noorm -H db transfer --to backup --dry-run

# Export to files
noorm -H db transfer --export ./backup/                      # All tables, plain .dt
noorm -H db transfer --export ./backup/ --compress           # Compressed .dtz
noorm -H db transfer --export ./backup/ --passphrase secret  # Encrypted .dtzx
noorm -H db transfer --export ./backup/users.dt --tables users

# Import from files
noorm -H db transfer --import ./backup/users.dtz
noorm -H db transfer --import ./backup/users.dtzx --passphrase secret --on-conflict skip
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
noorm -H lock status    # Check if locked
noorm -H lock acquire   # Acquire lock
noorm -H lock release   # Release lock
noorm -H lock force     # Force-release any lock (emergency)
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
noorm -H lock acquire
trap "noorm -H lock release" EXIT
noorm -H change ff
```

---

### vault

Team-shared encrypted secrets stored in the database.

```bash
noorm -H vault init                                # Initialize vault
noorm -H vault set API_KEY "sk-live-abc123"        # Store a secret
noorm -H vault list                                # List secret keys (values hidden)
noorm -H vault rm OLD_KEY                          # Remove a secret
noorm -H vault cp API_KEY staging production       # Copy between configs
noorm -H vault cp --all staging production         # Copy all secrets
noorm -H vault cp --all --force staging production # Overwrite existing
noorm -H vault propagate                           # Grant access to new team members
```

---

### sql

Execute raw SQL queries directly.

```bash
noorm -H sql "SELECT * FROM users LIMIT 10"
noorm -H sql -f query.sql                   # Read from file
noorm -H -c prod sql "SELECT count(*) FROM orders"
noorm -H --json sql "SELECT id, name FROM users"
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

---

### info

Project and database status overview.

```bash
noorm -H info
noorm -H --json info
```

Surfaces: CLI version, schema versions, active config, connection details, identity, database object counts.

### version

CLI version and diagnostic information.

```bash
noorm -H version
noorm -H --json version
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
          noorm -H run build
          noorm -H change ff
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
          noorm -H run build
          noorm -H change ff
      - run: npm test
```

### GitLab CI

```yaml
migrate:
  stage: deploy
  image: node:22
  script:
    - npm install -g @noormdev/cli
    - noorm -H run build
    - noorm -H change ff
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
noorm -H lock acquire
trap "noorm -H lock release" EXIT

# Build schema and apply changes
noorm -H run build
noorm -H change ff

# Verify
noorm -H --json db explore
```

## Scripting Patterns

### Check for pending changes before deploying

```bash
pending=$(noorm -H --json change | jq '[.[] | select(.status == "pending")] | length')
if [ "$pending" -gt 0 ]; then
    echo "Found $pending pending changes"
    noorm -H change ff
fi
```

### Verify table count after migration

```bash
tables=$(noorm -H --json db explore | jq '.tables')
echo "Database has $tables tables"
```

### Check for failures in change history

```bash
failures=$(noorm -H --json change history | jq '[.[] | select(.status == "failed")] | length')
if [ "$failures" -gt 0 ]; then
    echo "WARNING: $failures failed changes in history"
    exit 1
fi
```

### Render template and pipe to external tool

```bash
noorm -H run preview sql/hotfix.sql.tmpl | psql -h localhost -d myapp
```

### Check template context before rendering

```bash
files=$(noorm -H --json run inspect sql/seed.sql.tmpl | jq '.context.dataFiles | length')
echo "Template has $files data files available"
```

### Check vault access and propagate if needed

```bash
pending=$(noorm -H --json vault list | jq '.status.usersWithoutAccess')
if [ "$pending" -gt 0 ]; then
    noorm -H vault propagate
fi
```

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (check stderr or `--json` output) |
