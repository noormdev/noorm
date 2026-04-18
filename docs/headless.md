# CLI Reference


Every `noorm` command runs as a non-interactive CLI by default — perfect for CI/CD pipelines, scripts, and automation. The Ink/React TUI lives behind a separate subcommand:

```bash
noorm run build              # CLI: build schema headlessly
noorm --json change ff       # CLI: fast-forward with JSON output
noorm ui                     # TUI: launch the interactive terminal UI
```

There is no mode detection, no `--headless` or `--tui` flag, no CI heuristic. If you want the wizard, run `noorm ui` explicitly.


## Discovering Commands

Every command exposes native `--help` rendered by [citty](https://github.com/unjs/citty). The root help lists every subcommand; per-command help shows arguments, options, and examples.

```bash
noorm --help                 # Top-level command list
noorm change --help          # Subcommands of `change`
noorm change ff --help       # Args, options, and examples for `change ff`
```

For shell completion, run `noorm complete` and follow the printed instructions for your shell.


## Common Flags

These options are reused across most commands. Run `<command> --help` to see exactly which apply.

| Flag | Short | Description |
|------|-------|-------------|
| `--json` | — | Emit machine-readable JSON instead of human-friendly text |
| `--config` | `-c` | Use a specific stored configuration (overrides the active one) |
| `--force` | `-f` | Skip checksum / safety checks |
| `--yes` | `-y` | Skip confirmation prompts |
| `--dry-run` | — | Preview without executing |
| `--help` | `-h` | Show command help (citty native) |


## Configuration


### Using a Stored Config

```bash
# Use active config
noorm run build

# Use specific config
noorm --config staging run build

# Or via environment
export NOORM_CONFIG=staging
noorm run build
```


### Environment-Only Mode

No stored config needed. Set connection via environment variables:

```bash
export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_HOST=db.example.com
export NOORM_CONNECTION_DATABASE=myapp
export NOORM_CONNECTION_USER=deploy
export NOORM_CONNECTION_PASSWORD=$DB_PASSWORD

noorm run build
```

**Minimum required:**
- `NOORM_CONNECTION_DIALECT` (postgres, mysql, sqlite, mssql)
- `NOORM_CONNECTION_DATABASE`


### All Environment Variables

**Connection:**
```bash
NOORM_CONNECTION_DIALECT     # postgres, mysql, sqlite, mssql
NOORM_CONNECTION_HOST        # Database host
NOORM_CONNECTION_PORT        # Database port
NOORM_CONNECTION_DATABASE    # Database name
NOORM_CONNECTION_USER        # Username
NOORM_CONNECTION_PASSWORD    # Password
```

**Paths:**
```bash
NOORM_PATHS_SQL          # Schema directory (default: ./sql)
NOORM_PATHS_CHANGES         # Changes directory (default: ./changes)
```

**Behavior:**
```bash
NOORM_CONFIG                # Config name to use
NOORM_YES                   # Skip confirmations (1 or true)
NOORM_JSON                  # Output JSON (1 or true)
NOORM_DEBUG                 # Enable debug logging
```


### Environment Variable Overrides

All `NOORM_*` environment variables are processed through a nesting convention that maps underscores to object depth. This lets you override any config property from the environment without editing files.

**Meta variables** are handled separately and control CLI behavior rather than config values:

| Variable | Purpose |
|----------|---------|
| `NOORM_CONFIG` | Select which stored config to use |
| `NOORM_YES` | Skip confirmations (`1` or `true`) |
| `NOORM_JSON` | Force JSON output (`1` or `true`) |

These are excluded from config nesting and consumed directly by the CLI.

**Nesting rules** -- underscore separates object levels after stripping the `NOORM_` prefix:

```
NOORM_CONNECTION_HOST       → connection.host
NOORM_CONNECTION_PORT       → connection.port
NOORM_PATHS_SQL             → paths.sql
NOORM_PATHS_CHANGES         → paths.changes
```

**Type conversion** -- string values are auto-converted:
- Numbers: `NOORM_CONNECTION_PORT=5432` becomes `5432` (number)
- Booleans: `NOORM_DEBUG=true` becomes `true` (boolean)
- Password fields skip conversion and remain strings regardless of content

**Priority order** (highest to lowest):
1. CLI flags (`--config`, `--json`, `--yes`)
2. Environment variables (`NOORM_*`)
3. Settings file (`.noorm/settings.yml`)
4. Config defaults


## Commands


### Configuration

#### `config`

List subcommands and show config overview.

```bash
noorm config
```

Displays help text with available subcommands. Parent route only -- no JSON output.


#### `config add`

Create a new configuration.

> Wizard-only — running this command launches the TUI wizard via `noorm ui`. There is no fully headless equivalent because the wizard exists to guide credential entry interactively. To configure non-interactively, use `NOORM_*` environment variables instead.

```bash
noorm config add
```


#### `config edit`

Edit an existing configuration.

> Wizard-only — launches the TUI wizard. Use `NOORM_*` env vars or stored config files to override values non-interactively.

```bash
noorm config edit dev
```


#### `config rm`

Remove a configuration.

> Wizard-only — launches the TUI wizard so you can confirm the removal interactively.

```bash
noorm config rm staging
```


#### `config use`

Set the active configuration.

```bash
noorm config use dev
noorm --json config use production
```

**JSON output:**
```json
{
    "activeConfig": "production"
}
```

**Error output (--json):**
```json
{
    "success": false,
    "error": "Config name required. Usage: noorm config use <name>"
}
```


### Schema Operations

#### `run build`

Execute all SQL files in the schema directory.

```bash
noorm run build
noorm --force run build    # Skip checksums, run everything
noorm --dry-run run build  # Preview without executing
```

**Text output:**
```
Building schema...
✓ sql/01_tables/001_users.sql
✓ sql/01_tables/002_posts.sql
• sql/02_views/001_recent.sql (unchanged)

Executed: 2
Skipped: 1
```

**JSON output:**
```json
{
    "status": "success",
    "filesRun": 2,
    "filesSkipped": 1,
    "filesFailed": 0,
    "durationMs": 234
}
```


#### `run file <path>`

Execute a single SQL file. Supports `.sql` and `.sql.tmpl` (templated) files.

```bash
noorm run file sql/01_tables/001_users.sql
noorm run file seed.sql.tmpl
noorm --json run file sql/init.sql
```

**JSON output:**
```json
{
    "filepath": "seed.sql",
    "status": "success",
    "durationMs": 45
}
```

Status is `"success"` or `"skipped"` (unchanged checksum).


#### `run dir <path>`

Execute all SQL files in a directory in alphabetical order. Supports `.sql` and `.sql.tmpl` files.

```bash
noorm run dir sql/01_tables/
noorm run dir seeds/
noorm --json run dir migrations/
```

**JSON output:**
```json
{
    "status": "success",
    "filesRun": 3,
    "filesSkipped": 1,
    "filesFailed": 0
}
```


#### `run inspect <path>`

Inspect the template context for a `.sql.tmpl` file without executing or rendering it. Shows data files, helpers, config, secrets, and built-in functions available in the template's `$` context.

Useful for debugging templates -- see what variables are accessible before rendering.

```bash
noorm run inspect sql/users/001_create.sql.tmpl
noorm --json run inspect sql/core/05_Cron/Crons.sql.tmpl
```

**Text output:**
```
Template: sql/users/001_create.sql.tmpl
Config:   staging

Data Files:
  $.roles  Array [3]
  $.permissions  Object {read, write, admin}

Helpers ($helpers):
  $.padId  Function

Built-ins: quote, escape, uuid, now, json, include
Secrets: 2 config, 0 global
```

**JSON output:**
```json
{
    "filepath": "sql/users/001_create.sql.tmpl",
    "context": {
        "dataFiles": [{"key": "roles", "type": "Array [3]"}],
        "helpers": [{"key": "padId", "type": "Function"}],
        "helperErrors": [],
        "builtins": ["quote", "escape", "uuid", "now", "json", "include"],
        "configKeys": ["name", "connection"],
        "secretCount": 2,
        "globalSecretCount": 0
    }
}
```

**Scripting pattern -- check available data files before rendering:**
```bash
files=$(noorm --json run inspect sql/seed.sql.tmpl | jq '.context.dataFiles | length')
echo "Template has $files data files available"
```


#### `run preview <path>`

Render a `.sql.tmpl` file with the full context (config, secrets, data files, helpers) and output the resulting SQL. Does not execute the SQL against any database.

By default outputs raw SQL to stdout -- pipe-friendly. With `--json`, wraps the SQL in a JSON envelope.

```bash
# Output raw SQL
noorm run preview sql/users/001_create.sql.tmpl

# Pipe rendered SQL to a file
noorm run preview sql/schema.sql.tmpl > rendered.sql

# Extract SQL from JSON envelope
noorm --json run preview sql/seed.sql.tmpl | jq -r .sql

# Preview with a specific config
noorm --config staging run preview sql/migrations/002.sql.tmpl
```

**JSON output:**
```json
{
    "filepath": "sql/users/001_create.sql.tmpl",
    "sql": "CREATE TABLE users (\n  id INT PRIMARY KEY\n);",
    "durationMs": 12
}
```

**Scripting pattern -- render and apply in one pipeline:**
```bash
noorm run preview sql/hotfix.sql.tmpl | psql -h localhost -d myapp
```


### Change Operations

Bare `noorm change` renders citty's help output and does not connect to the database. Use `noorm change list` for the status table.

**Interactive prompts (TTY only).** When you omit the change name on a TTY, `run`, `revert`, `rewind`, `edit`, `rm`, and `history-detail` open a clack picker filtered to the relevant subset:

| Command | Picker includes |
|---------|-----------------|
| `change run` | pending + reverted (not orphaned) |
| `change revert` | success |
| `change rewind` | success |
| `change edit` | every directory under `changes/` (filesystem) |
| `change rm` | every directory under `changes/` (filesystem) |
| `change history-detail` | anything with an execution record (non-pending) |

Non-TTY callers (CI, scripts) must pass the name or the command errors out -- there is no interactive fallback.


#### `change list`

List every known change with its status. This used to be the behavior of bare `noorm change`; it now lives on an explicit subcommand so the parent command can render help without connecting to the database.

```bash
noorm change list
noorm change list --json
noorm change list -c staging
```

**Text output:**
```
2024-01-15-init-schema (success)
2024-01-20-add-roles (success)
2024-02-01-notifications (pending)
1 pending change(s)
```

**JSON output:**
```json
[
    {"name": "2024-01-15-init-schema", "status": "success"},
    {"name": "2024-01-20-add-roles", "status": "success"},
    {"name": "2024-02-01-notifications", "status": "pending"}
]
```


#### `change ff`

Fast-forward: apply all pending changes.

```bash
noorm change ff
noorm --dry-run change ff  # Preview only
```

**JSON output:**
```json
{
    "status": "success",
    "applied": 2,
    "skipped": 0,
    "failed": 0,
    "changes": [
        {"name": "2024-02-01-notifications", "status": "success", "durationMs": 45}
    ]
}
```


#### `change next`

Apply the next pending change in order (whichever comes first in the sorted list of pending changes). Useful in CI for one-step-at-a-time rollouts.

```bash
noorm change next
noorm --json change next
noorm --dry-run change next
```

Output shape matches `change run` (single-change result).


#### `change run <name>`

Apply a specific change by name. Use this to apply changes out of order or to retry a failed change. On a TTY, omit the name to pick from pending + reverted changes interactively.

```bash
noorm change run                               # interactive picker (TTY)
noorm change run 2024-02-01-notifications
noorm --json change run 2024-02-01-notifications
noorm -c staging change run 001_init
```

**Text output:**
```
2024-02-01-notifications (success)
```

**JSON output:**
```json
{
    "name": "2024-02-01-notifications",
    "direction": "change",
    "status": "success",
    "files": [
        {"filepath": "change/001_create-table.sql", "checksum": "a1b2c3", "status": "executed", "durationMs": 23}
    ],
    "durationMs": 45
}
```

Status is `"success"` or `"failed"`. On failure, the top-level `error` field contains the message.


#### `change revert <name>`

Revert a previously applied change by running its backward SQL. On a TTY, omit the name to pick from previously-applied changes.

```bash
noorm change revert                              # interactive picker (TTY)
noorm change revert 2024-02-01-notifications
noorm --json change revert 2024-02-01-notifications
noorm -c staging change revert 002_users
```

**Text output:**
```
002_users reverted (success)
```

**JSON output:**
```json
{
    "name": "2024-02-01-notifications",
    "direction": "revert",
    "status": "success",
    "files": [
        {"filepath": "revert/001_drop-table.sql", "checksum": "d4e5f6", "status": "executed", "durationMs": 12}
    ],
    "durationMs": 30
}
```

Status is `"success"` or `"failed"`. The change must have been previously applied.


#### `change rewind <name>`

Revert the given change **and every change applied after it**, in reverse chronological order. Use this to rewind to a specific point. On a TTY, omit the name to pick the anchor change interactively.

```bash
noorm change rewind                              # interactive picker (TTY)
noorm change rewind 2024-02-01-notifications
noorm --json change rewind 2024-02-01-notifications
```

JSON output mirrors `change ff` (rollup of per-change results).


#### `change add [description]`

Scaffold a new change directory under `changes/` with `change.sql` and `revert.sql` stubs. On a TTY, omit the description to be prompted for one.

```bash
noorm change add                                # prompts for description (TTY)
noorm change add add-users-table
noorm change add "notification queue"
```

Creates `changes/<YYYY-MM-DD>-<slug>/` with empty template files.


#### `change edit [name]`

Open a change's `change.sql` and `revert.sql` in `$EDITOR` (or `$VISUAL`). On a TTY, omit the name to pick from all changes on disk.

```bash
noorm change edit                               # interactive picker (TTY)
noorm change edit 2024-02-01-notifications
EDITOR=vim noorm change edit 001_init
```

Exits with the editor's exit code if non-zero. No JSON output -- this command is purely a spawn wrapper.


#### `change rm [name]`

Remove a change directory from disk. **Does not** touch database state -- use `change revert` or `change rewind` first if the change was applied. On a TTY, omit the name to pick interactively and confirm via prompt; `--yes` is only required on non-TTY callers.

```bash
noorm change rm                                 # picker + confirm (TTY)
noorm change rm 2024-02-01-notifications        # confirm prompt (TTY)
noorm change rm 2024-02-01-notifications --yes  # non-TTY / CI
```


#### `change history`

View execution history of changes including timestamps, direction, and duration.

```bash
noorm change history
noorm --json change history
noorm --count 50 change history
```

**Text output:**
```
Execution History: 3 records
  001_init - success (1/15/2024, 10:30:00 AM)
  002_users - success (1/20/2024, 2:15:00 PM)
  002_users - success (1/21/2024, 9:00:00 AM)
```

**JSON output:**
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

**Scripting pattern -- check for recent failures:**
```bash
failures=$(noorm --json change history | jq '[.[] | select(.status == "failed")] | length')
if [ "$failures" -gt 0 ]; then
    echo "WARNING: $failures failed changes in history"
fi
```


#### `change history-detail <name>`

Show per-file execution detail for a single change (all historical runs, forward and revert). On a TTY, omit the name to pick from changes with execution history.

```bash
noorm change history-detail                     # interactive picker (TTY)
noorm change history-detail 2024-02-01-notifications
noorm --json change history-detail 001_init
```

JSON output is an array of per-execution records with their file checksums, statuses, and durations.


### Database Operations

#### `db explore`

Get schema overview.

```bash
noorm db explore
```

**JSON output:**
```json
{
    "tables": 12,
    "views": 3,
    "indexes": 8,
    "functions": 2,
    "procedures": 0
}
```


#### `db explore tables`

List all tables.

```bash
noorm db explore tables
```


#### `db explore tables detail <name>`

Describe a specific table.

```bash
noorm db explore tables detail users
```

**JSON output:**
```json
{
    "name": "users",
    "columns": [
        {"name": "id", "type": "integer", "nullable": false, "primaryKey": true},
        {"name": "email", "type": "varchar(255)", "nullable": false}
    ]
}
```


#### `db truncate`

Wipe all data, keep schema.

```bash
noorm -y db truncate
```


#### `db teardown`

Drop all database objects.

```bash
noorm -y db teardown
```

::: warning Protected Configs
`db teardown` is blocked on protected configs. Use `--force` to override (be careful!).
:::


#### `db transfer`

Transfer data between database configurations, or export/import `.dt` files. Three mutually exclusive modes: database-to-database, export, and import.

**Database-to-database transfer:**

Transfer all or selected tables from the active config to another config. Both must use the same dialect. Same-server transfers use direct `INSERT...SELECT`; cross-server transfers use batched reads/writes.

```bash
# Transfer all tables from active config to backup
noorm db transfer --to backup

# Transfer specific tables
noorm db transfer --to backup --tables users,posts,comments

# Upsert behavior (update existing rows)
noorm db transfer --to backup --on-conflict update

# Clear destination before transfer
noorm db transfer --to backup --truncate

# Preview transfer plan without executing
noorm db transfer --to backup --dry-run

# Transfer from named source to destination
noorm db transfer staging --to production --tables users
```

**JSON output (transfer):**
```json
{
    "success": true,
    "status": "success",
    "tables": [
        {
            "table": "users",
            "status": "success",
            "rowsTransferred": 1500,
            "rowsSkipped": 0,
            "durationMs": 234
        }
    ],
    "totalRows": 1500,
    "durationMs": 1234
}
```

**JSON output (dry run):**
```json
{
    "success": true,
    "dryRun": true,
    "sameServer": true,
    "tableCount": 3,
    "estimatedRows": 5000,
    "tables": [
        {
            "name": "users",
            "rowCount": 1500,
            "hasIdentity": true,
            "dependsOn": []
        },
        {
            "name": "posts",
            "rowCount": 3500,
            "hasIdentity": true,
            "dependsOn": ["users"]
        }
    ],
    "warnings": []
}
```

**Export mode:**

Write tables to `.dt` (plain), `.dtz` (compressed), or `.dtzx` (encrypted) files. Single-table export uses the path as a filename; multi-table export uses it as a directory.

```bash
# Export single table (plain .dt)
noorm db transfer --export ./backup/users.dt --tables users

# Export single table compressed
noorm db transfer --export ./backup/users --tables users --compress

# Export all tables to directory
noorm db transfer --export ./backup/

# Export all tables compressed
noorm db transfer --export ./backup/ --compress

# Export with encryption (implies compression)
noorm db transfer --export ./backup/ --passphrase mySecret
```

**JSON output (export):**
```json
{
    "success": true,
    "mode": "export",
    "directory": "./backup/",
    "tables": [
        {
            "table": "users",
            "filepath": "./backup/users.dtz",
            "rowsExported": 1500,
            "bytesWritten": 48320
        }
    ],
    "totalRows": 1500,
    "totalBytes": 48320
}
```

**Import mode:**

Load `.dt`, `.dtz`, or `.dtzx` files into the active database.

```bash
# Import from .dt file
noorm db transfer --import ./backup/users.dt

# Import encrypted file with conflict skipping
noorm db transfer --import ./backup/users.dtzx --passphrase mySecret --on-conflict skip
```

**JSON output (import):**
```json
{
    "success": true,
    "mode": "import",
    "filepath": "./backup/users.dt",
    "rowsImported": 1500,
    "rowsSkipped": 0
}
```

**Transfer flags:**

| Flag | Description |
|------|-------------|
| `--to` | Destination config name (db-to-db mode) |
| `--export` | Export path: file or directory |
| `--import` | Import from `.dt`/`.dtz`/`.dtzx` file |
| `--compress` | Compress export as `.dtz` (default: plain `.dt`) |
| `--passphrase` | Passphrase for `.dtzx` encryption/decryption |
| `--tables` | Comma-separated list of tables (default: all) |
| `--on-conflict` | Conflict strategy: `fail`, `skip`, `update`, `replace` (default: `fail`) |
| `--batch-size` | Rows per batch for cross-server transfers (default: 1000) |
| `--truncate` | Truncate destination tables before transfer |
| `--no-fk` | Do not disable foreign key checks |
| `--no-identity` | Do not preserve identity/auto-increment values |
| `--dry-run` | Show transfer plan without executing |

**Conflict strategies:**

| Strategy | Behavior |
|----------|----------|
| `fail` | Abort on first primary key conflict (default) |
| `skip` | Skip conflicting rows, continue transfer |
| `update` | Update existing rows with source data |
| `replace` | Delete and re-insert conflicting rows |


### Lock Operations

#### `lock status`

Check if database is locked.

```bash
noorm lock status
noorm --json lock status
```

**JSON output (locked):**
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

**JSON output (not locked):**
```json
{
    "isLocked": false,
    "lock": null
}
```


#### `lock acquire`

Acquire an exclusive lock on the database.

```bash
noorm lock acquire
noorm --json lock acquire
```

CI/CD pattern with cleanup:

```bash
noorm lock acquire
trap "noorm lock release" EXIT
noorm change ff
```

**JSON output:**
```json
{
    "acquired": true,
    "lockedBy": "deploy@ci-runner",
    "expiresAt": "2024-01-15T10:35:00Z"
}
```


#### `lock release`

Release the current database lock. Only the lock holder can release.

```bash
noorm lock release
noorm --json lock release
```

**JSON output:**
```json
{
    "released": true
}
```


#### `lock force`

Force release any database lock regardless of ownership. Use when a lock holder crashed or when emergency intervention is needed.

> **Warning:** Force releasing a lock can cause data corruption if the original holder is still running operations.

```bash
noorm lock force
noorm --json lock force
```

**JSON output:**
```json
{
    "released": true,
    "forced": true
}
```


### Vault Operations

Vault secrets are team-shared encrypted secrets stored in the database. They provide a fallback when local secrets are not set.

**Secret resolution order:**
1. Config-specific local secrets (highest priority)
2. Global local secrets
3. Vault secrets (team-shared, lowest priority)

All vault commands require an active config and initialized identity.


#### `vault`

Show vault help and subcommand list.

```bash
noorm vault
```


#### `vault init`

Initialize the vault for the current database.

```bash
noorm vault init
noorm --json vault init
```

The first user to initialize creates the vault encryption key. Other team members receive access via `vault propagate`.

**JSON output:**
```json
{
    "success": true,
    "message": "Vault initialized successfully"
}
```

If already initialized:
```json
{
    "success": true,
    "message": "Vault already initialized and you have access"
}
```


#### `vault set <key> <value>`

Store an encrypted secret in the vault.

```bash
noorm vault set API_KEY "sk-live-abc123"
noorm vault set DB_PASSWORD "secret"
noorm --json vault set API_KEY "sk-live-abc123"
```

Upserts -- creates the secret if new, updates if it already exists.

**JSON output:**
```json
{
    "success": true,
    "key": "API_KEY",
    "action": "set"
}
```


#### `vault list`

List all secrets in the vault with metadata.

```bash
noorm vault list
noorm --json vault list
```

Values are never exposed -- only keys and metadata (who set each secret and when) are returned.

**Text output:**
```
Vault secrets (2):
  API_KEY (set by alice@example.com)
  DB_PASSWORD (set by bob@example.com)
```

**JSON output:**
```json
{
    "success": true,
    "secrets": [
        {"key": "API_KEY", "setBy": "alice@example.com", "updatedAt": "2024-01-15T10:30:00Z"},
        {"key": "DB_PASSWORD", "setBy": "bob@example.com", "updatedAt": "2024-01-14T09:00:00Z"}
    ],
    "status": {
        "usersWithAccess": 3,
        "usersWithoutAccess": 1
    }
}
```

**Scripting pattern -- check for pending access:**
```bash
pending=$(noorm --json vault list | jq '.status.usersWithoutAccess')
if [ "$pending" -gt 0 ]; then
    noorm vault propagate
fi
```


#### `vault rm <key>`

Remove a secret from the vault.

```bash
noorm vault rm OLD_API_KEY
noorm --json vault rm OLD_API_KEY
```

Permanently deletes the secret. Fails if the key does not exist.

**JSON output:**
```json
{
    "success": true,
    "key": "OLD_API_KEY",
    "deleted": true
}
```


#### `vault cp`

Copy secrets between config vaults.

```bash
# Copy a single secret
noorm vault cp API_KEY staging production

# Copy all secrets
noorm vault cp --all staging production

# Overwrite existing secrets in destination
noorm vault cp --all --force staging production

# Preview without executing
noorm vault cp --all --dry-run staging production

# JSON output
noorm --json vault cp --all staging production
```

| Flag | Description |
|------|-------------|
| `--all` | Copy all secrets from source |
| `--force` | Overwrite existing secrets in destination |
| `--dry-run` | Preview what would be copied without executing |

Requires vault access on both source and destination configs. If the destination vault is not initialized, it will be initialized automatically.

Without `--force`, existing secrets in the destination are skipped.

**JSON output:**
```json
{
    "success": true,
    "copied": ["API_KEY", "DB_PASSWORD"],
    "skipped": ["EXISTING_KEY"],
    "errors": []
}
```

**JSON output (dry run):**
```json
{
    "success": true,
    "dryRun": true,
    "source": "staging",
    "destination": "production",
    "keys": "all",
    "force": false
}
```

**Scripting pattern -- mirror secrets across environments:**
```bash
# Copy all secrets from staging to production, overwriting stale values
noorm --config staging vault cp --all --force staging production

# Verify
noorm --config production --json vault list | jq '.secrets | length'
```


#### `vault propagate`

Grant vault access to team members who don't have it yet.

```bash
noorm vault propagate
noorm --json vault propagate
```

Encrypts the vault key with each pending user's public key so they can decrypt vault secrets. This happens automatically on connect, but can be run manually after new team members register.

**JSON output:**
```json
{
    "success": true,
    "propagatedTo": ["alice@example.com", "bob@example.com"],
    "alreadyHadAccess": 3
}
```

When all users already have access:
```json
{
    "success": true,
    "propagatedTo": [],
    "message": "All users already have vault access"
}
```

**Scripting pattern -- ensure all team members have access:**
```bash
result=$(noorm --json vault propagate)
count=$(echo "$result" | jq '.propagatedTo | length')
echo "Granted access to $count new users"
```


### Utility Commands

#### `info`

Project and database status overview.

```bash
noorm info
noorm --json info
```

Surfaces noorm metadata: CLI version, schema versions, install/upgrade dates, active configuration, connection details, identity info, and database object counts.

**JSON output:**
```json
{
    "cli_version": "0.4.2",
    "schema_version": 1,
    "state_version": 1,
    "settings_version": 1,
    "installed_at": "2026-01-15T08:30:00.000Z",
    "upgraded_at": "2026-03-10T14:22:00.000Z",
    "active_config": "dev",
    "config_count": 2,
    "connection": {
        "host": "localhost",
        "port": 5432,
        "database": "mydb",
        "dialect": "postgresql"
    },
    "identity": {
        "name": "Your Name",
        "email": "you@example.com",
        "machine": "hostname",
        "registered_at": "2026-01-15T08:30:00.000Z",
        "last_seen_at": "2026-03-13T22:00:00.000Z"
    },
    "objects": {
        "tables": 5,
        "views": 12,
        "functions": 8,
        "procedures": 9,
        "types": 13
    }
}
```

**Scripting pattern -- extract object counts:**
```bash
noorm --json info | jq '.objects'
```


#### `version`

Show CLI version and diagnostic information.

```bash
noorm version
noorm --json version
```

Displays the installed noorm version, Node.js environment, identity configuration paths/status, and project detection info. Useful for debugging installation and configuration issues.

**JSON output:**
```json
{
    "version": "1.0.0-alpha.3",
    "node": "v22.14.0",
    "platform": "darwin",
    "arch": "arm64",
    "identity": {
        "exists": true,
        "homePath": "~/.noorm",
        "privateKeyPath": "~/.noorm/identity.key",
        "publicKeyPath": "~/.noorm/identity.pub",
        "name": "Your Name",
        "email": "you@example.com"
    },
    "project": {
        "found": true,
        "path": "/path/to/project",
        "configCount": 2,
        "activeConfig": "dev"
    }
}
```


#### `sql`

Execute raw SQL queries from the command line.

```bash
noorm sql "SELECT * FROM users LIMIT 10"
noorm --json sql "SELECT 1"
noorm sql -f query.sql
noorm -c prod sql "SELECT count(*) FROM orders"
```

Runs a raw SQL query against the active (or specified) database configuration. Queries can be passed inline as a positional argument or read from a file with `-f`.

| Flag | Description |
|------|-------------|
| `-c, --config NAME` | Use specific configuration |
| `-f, --file PATH` | Read SQL from a file instead of inline |
| `--json` | Output results as JSON |

**JSON output:**
```json
{
    "success": true,
    "columns": ["id", "name"],
    "rows": [
        {"id": 1, "name": "Alice"},
        {"id": 2, "name": "Bob"}
    ],
    "rowsAffected": null,
    "durationMs": 12.5
}
```


#### `update`

Check for and install noorm updates.

```bash
noorm update
noorm --json update
```

Checks GitHub releases for the latest version and downloads the platform-appropriate binary if an update is available. The binary is replaced in-place -- restart to use the new version.

**JSON output:**
```json
{
    "currentVersion": "1.0.0-alpha.11",
    "latestVersion": "1.0.0-alpha.12",
    "updateAvailable": true,
    "installed": true
}
```

**Error output (--json):**
```json
{
    "currentVersion": "1.0.0-alpha.11",
    "latestVersion": null,
    "updateAvailable": false,
    "installed": false,
    "error": "Failed to check for updates (offline?)"
}
```


#### `--help`

Help is rendered natively by [citty](https://github.com/unjs/citty). Append `--help` (or `-h`) to any command to see its description, arguments, options, and curated examples.

```bash
noorm --help                 # Top-level command list
noorm change --help          # Subcommands of `change`
noorm change ff --help       # Args, options, and examples for `change ff`
noorm vault cp --help        # Same idea — drill in to any leaf command
```

Each command file ships an optional `examples: string[]` array; the root entry point intercepts `--help` and appends an `EXAMPLES` block beneath citty's auto-generated usage so the same examples shown in this guide are reachable from the terminal.

There is no JSON help format. Use `noorm <command> --help` for human-readable output and lean on this reference page for machine-discoverable structure.


#### `secret`

There is no `noorm secret` CLI command. Local (per-user) secret overrides are managed through the TUI:

```bash
noorm ui          # Then navigate to Settings → Secrets
```

For team-shared secrets stored in the database, use the [`vault` commands](#vault-operations) (`vault set`, `vault rm`, `vault list`, `vault init`, `vault propagate`). The vault is fully scriptable from CI.


#### `identity`

There is no `noorm identity` CLI command. In CI/CD, identity resolves automatically from `git config` (`user.name`, `user.email`) or `NOORM_IDENTITY` environment variables — the identity subsystem registers itself transparently when changes or locks need attribution. Use `noorm ui` to inspect or rotate identity locally.


#### `settings`

There is no `noorm settings` CLI command. Use `NOORM_*` environment variables for non-interactive configuration overrides (see [Environment Variable Overrides](#environment-variable-overrides) above) or run `noorm ui` to edit them in the wizard.


## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (check stderr or JSON output) |


## CI/CD Examples


### GitHub Actions

```yaml
name: Database Changes

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
          node-version: '20'

      - name: Install noorm
        run: npm install -g @noormdev/cli

      - name: Apply changes
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


### GitLab CI

```yaml
migrate:
  stage: deploy
  image: node:20
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


### Generic CI Pattern

```bash
#!/bin/bash
set -e

# Install
npm install -g @noormdev/cli

# Configure via environment
export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_HOST=$DB_HOST
export NOORM_CONNECTION_DATABASE=$DB_NAME
export NOORM_CONNECTION_USER=$DB_USER
export NOORM_CONNECTION_PASSWORD=$DB_PASSWORD

# Build schema
noorm run build

# Apply changes
noorm change ff

# Verify
noorm --json db explore
```


### Test Database Setup

```yaml
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
    - uses: actions/setup-node@v4
      with:
        node-version: '20'

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


## Scripting with JSON

Parse JSON output for programmatic use:

```bash
# Check if there are pending changes
pending=$(noorm --json change | jq '[.[] | select(.status == "pending")] | length')

if [ "$pending" -gt 0 ]; then
    echo "Found $pending pending changes"
    noorm change ff
fi
```

```bash
# Get table count
tables=$(noorm --json db explore | jq '.tables')
echo "Database has $tables tables"
```
