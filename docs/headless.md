# CLI Reference


Every `noorm` command runs as a non-interactive CLI by default. The Ink/React TUI lives behind a separate subcommand:

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


## Global Flags

These flags must appear **before** the subcommand (like `git -C`). After the subcommand they revert to their per-command meaning.

| Flag | Short | Description |
|------|-------|-------------|
| `--cwd <path>` | `-c <path>` | Run the subcommand inside `<path>`. Skips the walk-up that normally finds the nearest `.noorm/`. |

```bash
# Run the subcommand at packages/db, not the repo root
noorm -c packages/db run build

# Initialize a nested project from elsewhere
noorm -c packages/db init
```


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

> **Note:** `-c` is overloaded by position. `noorm -c <path> run` is the global cwd flag; `noorm run -c <name>` is the per-command config alias. The first non-flag token (the subcommand) is the boundary.


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

**Identity (CI):**
```bash
NOORM_IDENTITY_PRIVATE_KEY   # X25519 private key, hex PKCS8 DER (96 hex chars)
NOORM_IDENTITY_NAME          # Display name (e.g. "CI Bot")
NOORM_IDENTITY_EMAIL         # Email (e.g. "ci@example.com")
NOORM_CI_CONFIG_NAME         # Default config name for `ci init` (override: --name)
```

**Paths:**
```bash
NOORM_PATHS_SQL              # Schema directory (default: ./sql)
NOORM_PATHS_CHANGES          # Changes directory (default: ./changes)
```

**Behavior:**
```bash
NOORM_CONFIG                 # Config name to use
NOORM_YES                    # Skip confirmations (1 or true)
NOORM_JSON                   # Output JSON (1 or true)
NOORM_DEBUG                  # Enable debug logging
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


### Project Bootstrap

#### `init`

Bootstrap a new noorm project interactively. Creates identity (if needed), project structure (`sql/`, `changes/`, `.noorm/`), `settings.yml`, and encrypted `state.enc`.

```bash
noorm init              # Interactive, requires TTY
noorm init --force      # Reinitialize an existing .noorm/
```

**TTY required.** Fails with exit code 1 in CI or when stdin is piped. For headless setup, use `noorm ci init` instead.


### Configuration

#### `config list`

List available configurations.

```bash
noorm config list
noorm config list --json
```

**JSON output:**
```json
[
    {"name": "dev", "dialect": "postgres", "active": true},
    {"name": "staging", "dialect": "postgres", "active": false}
]
```


#### `config use <name>`

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


#### `config add`

Create a new configuration.

> Wizard-only. Launches the TUI wizard. To configure non-interactively, use `NOORM_*` environment variables or `config import`.

```bash
noorm config add
```


#### `config edit [name]`

Edit an existing configuration.

> Wizard-only. Launches the TUI wizard. Use `NOORM_*` env vars or `config export`/`config import` to modify non-interactively.

```bash
noorm config edit dev
```


#### `config rm [name]`

Remove a configuration.

> Wizard-only. Launches the TUI wizard so you can confirm the removal interactively.

```bash
noorm config rm staging
```


#### `config cp <src> <dest>`

Copy a configuration to a new name.

```bash
noorm config cp dev staging
noorm config cp dev prod --json
```

**JSON output:**
```json
{
    "success": true,
    "source": "dev",
    "destination": "staging"
}
```


#### `config export <name>`

Export a configuration to JSON. Useful for sharing configs between machines or backing up before edits.

```bash
noorm config export dev
noorm config export dev --output ./dev-config.json
```

| Flag | Description |
|------|-------------|
| `-o, --output` | Write to file instead of stdout |


#### `config import <path>`

Import a configuration from a JSON file.

```bash
noorm config import ./dev-config.json
noorm config import ./staging-config.json --force
```

| Flag | Description |
|------|-------------|
| `--force` | Overwrite existing config with the same name |


#### `config validate <name>`

Validate that a configuration can connect to its database.

```bash
noorm config validate dev
noorm config validate production --json
```

**JSON output:**
```json
{
    "success": true,
    "config": "dev",
    "dialect": "postgres",
    "durationMs": 120
}
```

Exit code 0 if valid, 1 if connection fails.


### Identity

Manage your cryptographic identity. Identity is used for change attribution, lock ownership, and vault encryption.

#### `identity init`

Create a new cryptographic identity. Generates an X25519 keypair and stores it at `~/.noorm/identity.{key,pub,json}`.

```bash
noorm identity init --name "Alice" --email "alice@example.com"
noorm identity init --name "Alice" --email "alice@example.com" --force
noorm --json identity init --name "Alice" --email "alice@example.com"
```

| Flag | Description |
|------|-------------|
| `--name` | Display name (required) |
| `--email` | Email address (required) |
| `--force` | Overwrite existing identity |

**JSON output:**
```json
{
    "name": "Alice",
    "email": "alice@example.com",
    "fingerprint": "...",
    "publicKey": "..."
}
```


#### `identity edit`

Update the display name or email on the existing identity.

```bash
noorm identity edit --name "Alice Cooper"
noorm identity edit --email "alice@newjob.com"
noorm identity edit --name "Alice" --email "alice@new.com" --json
```

At least one of `--name` or `--email` must be provided.


#### `identity export`

Print your public key so teammates can add you to encrypted vaults.

```bash
noorm identity export
noorm --json identity export
```


#### `identity list`

List all known users discovered from database syncs (the audit trail of who has touched shared state).

```bash
noorm identity list
noorm --json identity list
```


### Settings

Manage project settings stored in `.noorm/settings.yml`. Settings control paths, build rules, stages, strict mode, logging, and teardown behavior.

#### `settings init`

Initialize `settings.yml` with defaults.

```bash
noorm settings init
noorm settings init --force   # Overwrite existing
```


#### `settings build`

Reload `settings.yml` and re-save it. Applies missing defaults and normalizes formatting.

```bash
noorm settings build
```


#### `settings edit`

Interactive editor for settings sections: paths, build, strict, logging, stages, rules, teardown.

```bash
noorm settings edit      # Requires TTY
```

**TTY required.**


#### `settings secret`

Interactive editor for secret requirement declarations: which secrets are required for each stage.

```bash
noorm settings secret    # Requires TTY
```

**TTY required.** This manages requirement declarations, not secret values. Use `noorm secret set` or `noorm vault set` for values.


### Secrets (Config-Scoped)

Local secrets that override vault secrets for a specific config. These are stored on disk per-user (not shared with the team).

#### `secret list`

List secret keys for a config.

```bash
noorm secret list
noorm secret list --config prod
noorm secret list --json
```


#### `secret set <key> <value>`

Set a local secret for a config.

```bash
noorm secret set API_KEY "sk-live-..."
noorm secret set DB_PASSWORD "secret123" --config prod
noorm secret set API_KEY "sk-live-..." --json
```


#### `secret rm <key>`

Remove a local secret from a config.

```bash
noorm secret rm OLD_KEY --yes
noorm secret rm OLD_KEY --yes --config prod
```

Requires `--yes` to prevent accidental deletion.


### CI/CD Provisioning

The `ci` namespace bridges the gap between developer machines (which have `.noorm/` state on disk) and CI runners (which start from scratch on every job).

#### `ci init`

Bootstrap ephemeral `state.enc` from `NOORM_IDENTITY_*` + `NOORM_CONNECTION_*` env vars. Run inside the CI job.

```bash
noorm ci init
noorm ci init --name staging
noorm ci init --force          # Overwrite existing state.enc
noorm ci init --json
```

| Flag | Description |
|------|-------------|
| `--name` | Config name (default: `$NOORM_CI_CONFIG_NAME` or `"ci"`) |
| `--force` | Overwrite existing state.enc |

Creates a config, marks it active, sets `isTest: true`, and leaves state on disk so later commands (`run build`, `change ff`, `ci secrets`) work normally.

Fails fast with exit 1 if required env vars are missing or malformed.

**JSON output:**
```json
{
    "success": true,
    "identity": {
        "name": "CI Bot",
        "email": "ci@example.com",
        "publicKey": "...",
        "identityHash": "...",
        "source": "env"
    },
    "config": {"name": "ci", "dialect": "postgres", "database": "app", "isTest": true},
    "stateFile": "/path/to/.noorm/state/state.enc"
}
```


#### `ci secrets`

Batch-load secrets from a dotenv-style file into the active vault. Run after `ci init`.

```bash
noorm ci secrets --file ./ci-secrets.env
noorm ci secrets --file ./ci-secrets.env --overwrite
noorm ci secrets --file ./ci-secrets.env --config prod --json
```

| Flag | Description |
|------|-------------|
| `--file` | Path to dotenv file (required) |
| `--config` | Target config (default: active) |
| `--overwrite` | Replace existing keys |

**File format:** `KEY=value` per line; blank lines and `#` comments ignored; surrounding quotes stripped.

**Exit codes:** `0` all loaded; `1` precondition failure; `2` partial success.

**JSON output:**
```json
{
    "success": true,
    "config": "ci",
    "set": 3,
    "skipped": 0,
    "errors": 0
}
```


#### `ci identity new`

Generate a test-CI keypair locally. No database contact, no state written. Prints an env block to copy into CI secrets.

```bash
noorm ci identity new --name "CI Bot" --email ci@example.com
noorm ci identity new --name "CI Bot" --email ci@example.com --json
```

| Flag | Description |
|------|-------------|
| `--name` | Display name (required) |
| `--email` | Email address (required) |

The private key is shown once and never stored. Save it immediately.

**JSON output:**
```json
{
    "name": "CI Bot",
    "email": "ci@example.com",
    "publicKey": "...",
    "identityHash": "...",
    "privateKey": "...",
    "envBlock": {
        "NOORM_IDENTITY_PRIVATE_KEY": "...",
        "NOORM_IDENTITY_NAME": "CI Bot",
        "NOORM_IDENTITY_EMAIL": "ci@example.com"
    }
}
```


#### `ci identity enroll`

Register a CI identity in the target database and grant vault access. Run once by a developer who already has vault access.

```bash
noorm ci identity enroll --config prod --name "CI Bot" --email ci@example.com
noorm ci identity enroll --config prod --name "CI Bot" --email ci@example.com --public-key <hex>
```

| Flag | Description |
|------|-------------|
| `--config` | Target configuration (required) |
| `--name` | Display name (required) |
| `--email` | Email address (required) |
| `--public-key` | Pre-generated public key hex (air-gapped flow) |

Without `--public-key`, mints a keypair and returns the private key once. With `--public-key`, only enrolls the provided public half (for keys minted via `ci identity new`).

Idempotent on identityHash. Re-running ensures vault access.


### Schema Operations

#### `run build`

Execute all SQL files in the schema directory. Uses checksums to skip unchanged files.

```bash
noorm run build
noorm --force run build    # Skip checksums, run everything
noorm --dry-run run build  # Preview without executing
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

Execute a single SQL or `.sql.tmpl` file.

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


#### `run dir <path>`

Execute all SQL files in a directory in alphabetical order.

```bash
noorm run dir sql/01_tables/
noorm run dir seeds/
noorm --json run dir migrations/
```


#### `run exec <path>`

Batch-execute SQL files matching a glob pattern or directory. More flexible than `run dir`.

```bash
noorm run exec sql/
noorm run exec "sql/**/*.sql"
noorm run exec "seeds/*.sql" --force
noorm run exec migrations/ --dry-run
```

**Exit codes:** `0` success, `2` partial failure, `1` complete failure.


#### `run files --paths <path,...>`

Execute multiple specific SQL files in order.

```bash
noorm run files --paths seed.sql,fixtures.sql
noorm run files --paths sql/001_tables.sql,sql/002_indexes.sql --json
```


#### `run inspect <path>`

Inspect the template context for a `.sql.tmpl` file without executing. Shows data files, helpers, config, secrets, and built-in functions.

```bash
noorm run inspect sql/users/001_create.sql.tmpl
noorm --json run inspect sql/core/Crons.sql.tmpl
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


#### `run preview <path>`

Render a `.sql.tmpl` file and output the resulting SQL. Does **not** execute against the database.

```bash
noorm run preview sql/schema.sql.tmpl
noorm run preview sql/schema.sql.tmpl > rendered.sql
noorm --json run preview sql/seed.sql.tmpl
noorm --config staging run preview sql/migrations/002.sql.tmpl
```

**JSON output:**
```json
{
    "filepath": "sql/schema.sql.tmpl",
    "sql": "CREATE TABLE ...",
    "durationMs": 12
}
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

Non-TTY callers (CI, scripts) must pass the name or the command errors out.


#### `change list`

List every known change with its status.

```bash
noorm change list
noorm change list --json
noorm change list -c staging
```

**JSON output:**
```json
[
    {"name": "2024-01-15-init-schema", "status": "success"},
    {"name": "2024-02-01-notifications", "status": "pending"}
]
```


#### `change ff`

Fast-forward: apply all pending changes in order.

```bash
noorm change ff
noorm --dry-run change ff
noorm --force change ff
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

Apply the next pending change only.

```bash
noorm change next
noorm --json change next
```


#### `change run [name]`

Apply a specific change by name. Omit the name on a TTY to pick interactively.

```bash
noorm change run                               # interactive picker (TTY)
noorm change run 2024-02-01-notifications
noorm --json change run 2024-02-01-notifications
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


#### `change revert [name]`

Revert a previously applied change by running its rollback SQL. Omit the name on a TTY to pick interactively.

```bash
noorm change revert                              # interactive picker (TTY)
noorm change revert 2024-02-01-notifications
noorm --json change revert 002_users
```


#### `change rewind [name]`

Revert the given change **and every change applied after it**, in reverse order. Omit the name on a TTY to pick interactively.

```bash
noorm change rewind                              # interactive picker (TTY)
noorm change rewind 2024-02-01-notifications
noorm --json change rewind 001_init
```


#### `change add [description]`

Scaffold a new change directory. Omit the description on a TTY to be prompted.

```bash
noorm change add                                # prompts for description (TTY)
noorm change add add-users-table
noorm change add "notification queue" --json
```

Creates `changes/<YYYY-MM-DD>-<slug>/` with `change.sql` and `revert.sql` stubs.


#### `change edit [name]`

Open a change folder in `$EDITOR`. Omit the name on a TTY to pick interactively.

```bash
noorm change edit                               # interactive picker (TTY)
noorm change edit 2024-02-01-notifications
EDITOR=vim noorm change edit 001_init
```


#### `change rm [name]`

Remove a change directory from disk. Does **not** touch database state. On a TTY, omit the name to pick interactively; `--yes` is only required on non-TTY.

```bash
noorm change rm                                 # picker + confirm (TTY)
noorm change rm 2024-02-01-notifications --yes  # CI
```


#### `change history`

View execution history with timestamps, direction, and duration.

```bash
noorm change history
noorm --json change history
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


#### `change history-detail [name]`

Per-file execution detail for a single change. Omit the name on a TTY to pick interactively.

```bash
noorm change history-detail                     # interactive picker (TTY)
noorm change history-detail 001_init
noorm --json change history-detail 002_users
```


### Database Operations

#### `db create`

Create the target database if it does not exist. Connects to the dialect's system database (`postgres`, `master`, etc.) to issue the CREATE statement.

```bash
noorm db create
noorm db create -c dev
noorm db create --json
```


#### `db drop`

Drop the entire database.

```bash
noorm db drop --yes
noorm db drop -c dev --yes --json
```

::: danger Destructive
Drops the entire database. Requires `--yes`. Cannot drop protected configs without `--force`.
:::


#### `db reset`

Teardown + build (idempotent rebuild). Drops all user objects then rebuilds from SQL files.

```bash
noorm db reset --yes
noorm db reset -c dev --yes --json
```

::: danger Destructive
Equivalent to `db teardown` followed by `run build`. Requires `--yes`.
:::


#### `db explore`

Explore database schema.

```bash
noorm db explore                        # Overview counts
noorm db explore tables                 # List all tables
noorm db explore tables detail users    # Describe specific table
noorm db explore views                  # List all views
noorm db explore functions              # List all functions
noorm db explore procedures             # List all procedures
noorm db explore indexes                # List all indexes
noorm db explore types                  # List custom types
noorm db explore fks                    # List foreign keys
noorm --json db explore                 # JSON overview
```

**JSON output (overview):**
```json
{
    "tables": 12,
    "views": 3,
    "indexes": 8,
    "functions": 2,
    "procedures": 0
}
```


#### `db truncate`

Wipe all data from application tables. Schema and noorm tracking tables are preserved.

```bash
noorm -y db truncate
```


#### `db teardown`

Drop all database objects.

```bash
noorm -y db teardown
noorm --force db teardown   # Override protection
```

::: warning Protected Configs
`db teardown` is blocked on protected configs. Use `--force` to override.
:::


#### `db transfer`

Transfer data between database configurations, or export/import `.dt` files. Three mutually exclusive modes.

**Database-to-database:**
```bash
noorm db transfer --to backup
noorm db transfer --to backup --tables users,posts
noorm db transfer --to backup --on-conflict update
noorm db transfer --to backup --truncate
noorm db transfer --to backup --dry-run
```

**Export to files:**
```bash
noorm db transfer --export ./backup/
noorm db transfer --export ./backup/ --compress
noorm db transfer --export ./backup/ --passphrase secret
noorm db transfer --export ./backup/users.dt --tables users
```

**Import from files:**
```bash
noorm db transfer --import ./backup/users.dt
noorm db transfer --import ./backup/users.dtzx --passphrase secret --on-conflict skip
```

**Transfer flags:**

| Flag | Description |
|------|-------------|
| `--to` | Destination config name (db-to-db mode) |
| `--export` | Export path: file or directory |
| `--import` | Import from `.dt`/`.dtz`/`.dtzx` file |
| `--compress` | Compress export as `.dtz` |
| `--passphrase` | Passphrase for `.dtzx` encryption/decryption |
| `--tables` | Comma-separated table list (default: all) |
| `--on-conflict` | `fail`, `skip`, `update`, or `replace` (default: `fail`) |
| `--batch-size` | Rows per batch for cross-server transfers (default: 1000) |
| `--truncate` | Truncate destination tables before transfer |
| `--no-fk` | Do not disable foreign key checks |
| `--no-identity` | Do not preserve identity/auto-increment values |
| `--dry-run` | Show transfer plan without executing |


### Lock Operations

Tool-level mutual exclusion. Prevents concurrent schema migrations across noorm instances or CI runners targeting the same database.

#### `lock status`

Check if database is locked.

```bash
noorm lock status
noorm --json lock status
```

**JSON output:**
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


#### `lock acquire`

Acquire an exclusive lock.

```bash
noorm lock acquire
noorm --json lock acquire
```

**CI/CD pattern with cleanup:**
```bash
noorm lock acquire
trap "noorm lock release" EXIT
noorm change ff
```


#### `lock release`

Release the current lock. Only the lock holder can release.

```bash
noorm lock release
```


#### `lock force`

Force release any lock regardless of ownership.

```bash
noorm lock force
```

::: warning
Force releasing a lock can cause data corruption if the original holder is still running.
:::


### Vault Operations

Team-shared encrypted secrets stored in the database.

**Secret resolution order:**
1. Config-specific local secrets (highest)
2. Global local secrets
3. Vault secrets (team-shared, lowest)


#### `vault init`

Initialize the vault for the current database.

```bash
noorm vault init
noorm --json vault init
```


#### `vault set <key> <value>`

Store an encrypted secret in the vault.

```bash
noorm vault set API_KEY "sk-live-abc123"
noorm --json vault set API_KEY "sk-live-abc123"
```

Upserts: creates if new, updates if the key exists.


#### `vault list`

List all secrets in the vault (keys and metadata only, never values).

```bash
noorm vault list
noorm --json vault list
```

**JSON output:**
```json
{
    "success": true,
    "secrets": [
        {"key": "API_KEY", "setBy": "alice@example.com", "updatedAt": "2024-01-15T10:30:00Z"}
    ],
    "status": {
        "usersWithAccess": 3,
        "usersWithoutAccess": 1
    }
}
```


#### `vault rm <key>`

Remove a secret from the vault.

```bash
noorm vault rm OLD_API_KEY
noorm --json vault rm OLD_API_KEY
```


#### `vault cp`

Copy secrets between config vaults.

```bash
noorm vault cp API_KEY staging production
noorm vault cp --all staging production
noorm vault cp --all --force staging production
noorm vault cp --all --dry-run staging production
```

| Flag | Description |
|------|-------------|
| `--all` | Copy all secrets from source |
| `--force` | Overwrite existing secrets in destination |
| `--dry-run` | Preview without executing |

Without `--force`, existing secrets in the destination are skipped.


#### `vault propagate`

Grant vault access to team members who don't have it yet. Encrypts the vault key with each pending user's public key.

```bash
noorm vault propagate
noorm --json vault propagate
```

**JSON output:**
```json
{
    "success": true,
    "propagatedTo": ["alice@example.com"],
    "alreadyHadAccess": 3
}
```


### SQL Operations

#### `sql [query]`

Execute a raw SQL query.

```bash
noorm sql "SELECT * FROM users LIMIT 10"
noorm sql -f query.sql
noorm -c prod sql "SELECT count(*) FROM orders"
noorm --json sql "SELECT id, name FROM users"
```

| Flag | Description |
|------|-------------|
| `-f, --file` | Read SQL from a file |
| `-c, --config` | Use specific configuration |

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


#### `sql repl`

Launch the TUI SQL Terminal with multi-line editing, sortable results, and history.

```bash
noorm sql repl
noorm sql repl --config dev
```

**TTY required.**


#### `sql history`

Show SQL execution history.

```bash
noorm sql history
noorm sql history -n 20
noorm --json sql history
noorm -c prod sql history
```

| Flag | Description |
|------|-------------|
| `-n, --limit` | Max entries (default: 50) |


#### `sql clear`

Clear SQL execution history.

```bash
noorm sql clear --yes
noorm sql clear --older-than 3 --yes
noorm -c prod sql clear --yes
```

| Flag | Description |
|------|-------------|
| `--older-than` | Only clear entries older than N months |
| `--yes` | Confirm without prompt (required) |


### MCP (AI Agent Integration)

Model Context Protocol server for AI coding agents. Exposes noorm operations as MCP tools.

#### `mcp init`

Generate MCP configuration for a coding agent.

```bash
noorm mcp init                 # Default: Claude Code
noorm mcp init --agent cursor  # Cursor editor
noorm mcp init --json
```


#### `mcp serve`

Start the noorm MCP server on stdio transport. Designed to be spawned by an AI agent; stays alive as long as stdin is open.

```bash
noorm mcp serve
```


### Utility Commands

#### `info`

Project and database status overview.

```bash
noorm info
noorm --json info
```

**JSON output:**
```json
{
    "cli_version": "1.0.0-alpha.34",
    "schema_version": 1,
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
        "email": "you@example.com"
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


#### `version`

CLI version and diagnostic information.

```bash
noorm version
noorm --json version
```


#### `update`

Check for and install noorm updates.

```bash
noorm update
noorm --json update
```


#### `ui`

Launch the interactive terminal UI.

```bash
noorm ui
```

**TTY required.**


## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (check stderr or JSON output) |
| `2` | Partial failure (some operations succeeded, some failed) |


## CI/CD Examples


### Test CI (GitHub Actions)

Stateless, ephemeral. No identity or `ci init` needed.

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
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - name: Apply schema and changes
        env:
          NOORM_CONNECTION_DIALECT: postgres
          NOORM_CONNECTION_HOST: localhost
          NOORM_CONNECTION_DATABASE: test_db
          NOORM_CONNECTION_USER: postgres
          NOORM_CONNECTION_PASSWORD: test
        run: |
          npx noorm run build
          npx noorm change ff
      - run: npm test
```


### Prod CI (GitHub Actions, vault-enabled)

**One-time developer setup:**
```bash
noorm ci identity enroll --config prod --name "GitHub CI" --email ci@example.com
# → prints NOORM_IDENTITY_PRIVATE_KEY / NAME / EMAIL; copy to GitHub Secrets
```

**Pipeline:**
```yaml
name: Deploy Database Changes
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci

      - name: Bootstrap CI state
        env:
          NOORM_IDENTITY_PRIVATE_KEY: ${{ secrets.NOORM_CI_KEY }}
          NOORM_IDENTITY_NAME: "GitHub CI"
          NOORM_IDENTITY_EMAIL: "ci@example.com"
          NOORM_CONNECTION_DIALECT: postgres
          NOORM_CONNECTION_HOST: ${{ secrets.DB_HOST }}
          NOORM_CONNECTION_DATABASE: ${{ secrets.DB_NAME }}
          NOORM_CONNECTION_USER: ${{ secrets.DB_USER }}
          NOORM_CONNECTION_PASSWORD: ${{ secrets.DB_PASSWORD }}
        run: npx noorm ci init --name prod

      - name: Apply changes
        run: npx noorm change ff
```


### Prod CI with Batch Secrets

When templates need secrets beyond the connection:

```yaml
- name: Bootstrap CI state
  env:
    NOORM_IDENTITY_PRIVATE_KEY: ${{ secrets.NOORM_CI_KEY }}
    NOORM_IDENTITY_NAME: "GitHub CI"
    NOORM_IDENTITY_EMAIL: "ci@example.com"
    NOORM_CONNECTION_DIALECT: postgres
    NOORM_CONNECTION_HOST: ${{ secrets.DB_HOST }}
    NOORM_CONNECTION_DATABASE: ${{ secrets.DB_NAME }}
    NOORM_CONNECTION_USER: ${{ secrets.DB_USER }}
    NOORM_CONNECTION_PASSWORD: ${{ secrets.DB_PASSWORD }}
  run: npx noorm ci init --name prod

- name: Load secrets
  env:
    API_KEY: ${{ secrets.API_KEY }}
    STRIPE_KEY: ${{ secrets.STRIPE_KEY }}
  run: |
    cat > ./ci-secrets.env <<EOF
    API_KEY=$API_KEY
    STRIPE_KEY=$STRIPE_KEY
    EOF
    npx noorm ci secrets --file ./ci-secrets.env
    rm ./ci-secrets.env

- name: Apply changes
  run: npx noorm change ff
```


### GitLab CI

```yaml
migrate:
  stage: deploy
  image: node:22
  script:
    - npm ci
    - npx noorm ci init --name prod
    - npx noorm change ff
  variables:
    NOORM_IDENTITY_PRIVATE_KEY: $NOORM_CI_KEY
    NOORM_IDENTITY_NAME: "GitLab CI"
    NOORM_IDENTITY_EMAIL: "ci@example.com"
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

export NOORM_IDENTITY_PRIVATE_KEY=$NOORM_CI_KEY
export NOORM_IDENTITY_NAME="CI Bot"
export NOORM_IDENTITY_EMAIL="ci@example.com"
export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_HOST=$DB_HOST
export NOORM_CONNECTION_DATABASE=$DB_NAME
export NOORM_CONNECTION_USER=$DB_USER
export NOORM_CONNECTION_PASSWORD=$DB_PASSWORD

noorm ci init --name prod
noorm lock acquire
trap "noorm lock release" EXIT
noorm change ff
noorm --json db explore
```


## Scripting with JSON

```bash
# Check for pending changes
pending=$(noorm --json change list | jq '[.[] | select(.status == "pending")] | length')
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

```bash
# Verify vault access
pending=$(noorm --json vault list | jq '.status.usersWithoutAccess')
if [ "$pending" -gt 0 ]; then
    noorm vault propagate
fi
```

```bash
# Render template and pipe to external tool
noorm run preview sql/hotfix.sql.tmpl | psql -h localhost -d myapp
```
