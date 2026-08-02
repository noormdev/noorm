# CLI Reference


Every `noorm` command runs as a non-interactive CLI by default. The Ink/React TUI lives behind a separate subcommand:

```bash
noorm run build              # CLI: build schema headlessly
noorm change ff --json       # CLI: fast-forward with JSON output
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

For shell completion, run `noorm complete <shell>` and source the script it prints. Supported shells: `zsh`, `bash`, `fish`, `powershell`, `fig`. A bare `noorm complete` is the runtime completion hook, not a generator, and errors without `--`.


## Global Flags

A flag goes on the command that uses it. `-c`/`--cwd <path>` is the one exception: it's
recognized **before** the subcommand instead, because it's consumed before dispatch — it sets
the working directory everything else (config discovery, project root) resolves against. An
unrecognized or misplaced flag typed before the subcommand exits non-zero naming the correct
form, rather than being silently dropped.

| Flag | Short | Description |
|------|-------|-------------|
| `--cwd <path>` | `-c <path>` | Run the subcommand inside `<path>`. Skips the walk-up that normally finds the nearest `.noorm/`. |

```bash
# Run the subcommand at packages/db, not the repo root
noorm -c packages/db run build

# Initialize a nested project from elsewhere
noorm -c packages/db init

# every other flag belongs on the subcommand
noorm run build --dry-run
```

`--cwd`/`-c` only has this global meaning *before* the subcommand — after it, `-c` is the
per-command `--config` alias instead (see the note below).


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

> **Note:** `-c` is overloaded by position. `noorm -c <path> run` is the global cwd flag; `noorm run -c <name>` is the per-command config alias. The first non-flag token (the subcommand) is the boundary. Every flag other than `-c`/`--cwd` — `--config`, `--force`, `--json`, `--dry-run`, `--yes`, etc. — has no global meaning; it only works after the subcommand. See [CLI flag conventions](./cli/flags.md) for the full reasoning. For per-command help, see [Discovering command help](./cli/help.md).


## Configuration


### Using a Stored Config

```bash
# Use active config
noorm run build

# Use specific config
noorm run build --config staging

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
NOORM_DEBUG                  # Enable debug logging
```


### Environment Variable Overrides

All `NOORM_*` environment variables are processed through a nesting convention that maps underscores to object depth. This lets you override any config property from the environment without editing files.

**Meta variables** are handled separately and control CLI behavior rather than config values:

| Variable | Purpose |
|----------|---------|
| `NOORM_CONFIG` | Select which stored config to use |
| `NOORM_YES` | Skip confirmations (`1` or `true`) |
| `NOORM_CHANNEL` | Force the policy channel: `user` or `agent` (default: detected from the environment) |

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


## Access Roles

Each config carries a per-channel access grant: `access: { user, agent }`. The `user` role governs a human at the CLI, TUI, or SDK; `agent` governs an AI agent, over MCP or the CLI (see [MCP](./guide/automation/mcp.md)). Roles are fixed — `viewer`, `operator`, `admin` — and hard-coded to this matrix (cells: allow / confirm / deny):

| Command class | viewer | operator | admin |
|---|---|---|---|
| explore, `sql` reads | allow | allow | allow |
| `sql` writes (INSERT/UPDATE/DELETE) | deny | allow | allow |
| `sql` DDL (CREATE/ALTER/DROP/...) | deny | deny | allow |
| `change run`/`ff`/`revert`, `run build`/`file`/`dir` | deny | confirm | allow |
| `db create`, `db reset`, `db transfer --to` | deny | confirm | allow |
| `db truncate` | deny | confirm | confirm |
| `db teardown` | deny | deny | confirm |
| `db drop` | deny | deny | confirm |
| `config rm`, `config import --force` | deny | confirm | confirm |
| `change rm` | deny | confirm | confirm |
| `vault list`, `secret list`/`config export` | deny | allow | allow |
| `vault set`/`rm`, `secret set`/`rm` | deny | confirm | allow |
| `vault propagate` | deny | confirm | confirm |
| `lock force` | deny | confirm | confirm |

Raw SQL (`noorm sql`) is gated by what the statement actually does, not by a flag — a multi-statement input is classified by its highest class (a `SELECT` plus a `DROP` classifies as DDL). Unparseable or unrecognized statements classify as DDL, fail closed.

`confirm` means: type the phrase `yes-<config-name>` when prompted, or set `NOORM_YES=1` to skip the prompt in CI. There is no `--force` override for a denied permission — `--force` only skips file checksums (see [Common Flags](#common-flags)).

**Migration note:** the old `Config.protected: boolean` maps automatically on first load — `protected: true` becomes `{ user: 'operator', agent: 'viewer' }`, `protected: false` (or absent) becomes the default `{ user: 'admin', agent: 'viewer' }`. A config that already stores an explicit `access` keeps it untouched. The legacy field is still accepted on `config import` for one version, then dropped.


## Commands


### Project Bootstrap

#### `init`

Bootstrap a new noorm project interactively. Creates identity (if needed), project structure (`sql/`, `changes/`, `.noorm/`), `settings.yml`, and encrypted `state.enc`.

```bash
noorm init              # Interactive, requires TTY
noorm init --force      # Reinitialize an existing .noorm/
noorm init --yes        # Non-interactive, requires existing identity
```

**TTY required by default.** Fails with exit code 2 (usage error) in CI or when stdin is piped. For scripted bootstrap, set up the identity with `noorm identity init --name ... --email ...` then run `noorm init --yes` (or set `NOORM_YES=1`). For the full non-interactive matrix across all TTY-gated commands, see [Non-interactive operation](./guide/automation/non-interactive.md). For ephemeral CI runners, use `noorm ci init` instead.


### Configuration

#### `config list`

List available configurations.

```bash
noorm config list
noorm config list --json
```

**JSON output:**
```json
{
    "success": true,
    "configs": [
        {"name": "dev", "type": "local", "dialect": "postgres", "database": "app", "isActive": true, "isTest": false, "access": {"user": "admin", "agent": "viewer"}},
        {"name": "staging", "type": "remote", "dialect": "postgres", "database": "app", "isActive": false, "isTest": false, "access": {"user": "admin", "agent": "viewer"}}
    ]
}
```

Configs whose `access.agent` is `false` are omitted when the caller resolves to the `agent` channel — the same filtering the `list_configs` MCP command applies.


#### `config use <name>`

Set the active configuration.

```bash
noorm config use dev
noorm config use production --json
```

**JSON output:**
```json
{
    "success": true,
    "activeConfig": "production"
}
```


#### `config add`

Create a new configuration.

> Wizard-only. Launches the TUI wizard. To configure non-interactively, use `NOORM_*` environment variables or `config import`. Exits 1 (message on stderr) — there is no headless equivalent.

```bash
noorm config add
```


#### `config edit [name]`

Edit an existing configuration.

> Wizard-only. Launches the TUI wizard. Use `NOORM_*` env vars or `config export`/`config import` to modify non-interactively. Exits 1 (message on stderr) — there is no headless equivalent.

```bash
noorm config edit dev
```


#### `config rm <name>`

Remove a configuration.

```bash
noorm config rm staging --yes
noorm config rm staging --yes --json
```

**JSON output:**
```json
{
    "success": true,
    "name": "staging",
    "deleted": true
}
```

::: danger Destructive
Requires `--yes` (or `NOORM_YES=1`) — there is no TTY confirmation prompt, so the flag is mandatory even at an interactive terminal. An unknown config name fails with exit 2. Gated by the config's `config:rm` access (see [Access Roles](#access-roles) above); a config linked to a locked stage cannot be removed until the stage is unlocked.
:::


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
    "src": "dev",
    "dest": "staging"
}
```

A destination name that already exists fails with exit 1; `config cp` has no `--force`.


#### `config export <name>`

Export a configuration to JSON. Useful for sharing configs between machines or backing up before edits.

```bash
noorm config export dev
noorm config export dev --output ./dev-config.json
```

| Flag | Description |
|------|-------------|
| `-o, --output` | Write to file instead of stdout (mode `0600`) |

Plain `config export dev` writes the bare config object — the exact shape `config import` reads — so `noorm config export dev > dev.json` round-trips. `--json` wraps it in the envelope instead (`{"success": true, "name": "dev", "config": {…}}`), which is not importable as-is.

The export carries the connection password in plaintext, so it is gated by `secret:read`: a `viewer` is denied.


#### `config import <path>`

Import a configuration from a JSON file.

```bash
noorm config import ./dev-config.json
noorm config import ./staging-config.json --force --yes
```

| Flag | Description |
|------|-------------|
| `--force` / `-f` | Overwrite existing config with the same name |
| `--yes` / `-y` | Confirm the overwrite. Required with `--force`, because replacing a config rewrites its `access` roles — a `config:write` confirm cell for every role that holds it |


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
    "valid": true,
    "checks": [
        {"label": "Connection", "status": "success", "detail": "Connection successful"},
        {"label": "Name", "status": "success", "detail": "dev"}
    ]
}
```

Exit code 0 if valid, 1 if any check fails, 2 if the config name is unknown.


### Identity

Manage your cryptographic identity. Identity is used for change attribution, lock ownership, and vault encryption.

#### `identity init`

Create a new cryptographic identity. Generates an X25519 keypair and stores it at `~/.noorm/identity.{key,pub,json}`.

```bash
noorm identity init --name "Alice" --email "alice@example.com"
noorm identity init --name "Alice" --email "alice@example.com" --force --yes
noorm identity init --name "Alice" --email "alice@example.com" --json
```

| Flag | Description |
|------|-------------|
| `--name` | Display name (required) |
| `--email` | Email address (required) |
| `--force` | Replace an existing identity. Requires `--yes` |
| `--yes` / `-y` | Confirm the replacement. The flag is read literally here, so an ambient `NOORM_YES` does not satisfy it |

::: danger Destructive
The state encryption key derives from the private key, so replacing an identity orphans every `state.enc` on the machine — configs, secrets, and database passwords become permanently undecryptable. Nothing re-encrypts existing state under the new key. The old keypair is backed up first, and its path lands in `backedUpTo` on the result; restoring `identity.key` from it is the only way back.
:::

**JSON output:**
```json
{
    "success": true,
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
noorm identity export --json
```


#### `identity list`

List all known users discovered from database syncs (the audit trail of who has touched shared state).

```bash
noorm identity list
noorm identity list --json
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

**TTY required.** `--yes` / `NOORM_YES` errors with a redirect hint — edit `settings.yml` directly. See [Non-interactive operation](./guide/automation/non-interactive.md).


#### `settings secret`

Interactive editor for secret requirement declarations: which secrets are required for each stage.

```bash
noorm settings secret    # Requires TTY
```

**TTY required.** This manages requirement declarations, not secret values. Use `noorm secret set` or `noorm vault set` for values. `--yes` / `NOORM_YES` errors with a redirect hint pointing at direct YAML edits.


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

**Exit codes:** `0` all loaded; `1` total failure; `2` bad invocation (unknown config, unreadable or malformed `--file`); `3` partial (some keys set, some errored).

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
noorm run build --force    # Skip checksums, run everything
noorm run build --dry-run  # Preview without executing
```

**JSON output:**
```json
{
    "success": true,
    "status": "success",
    "files": [
        {"filepath": "sql/01_tables/users.sql", "status": "success", "checksum": "…", "durationMs": 12}
    ],
    "filesRun": 2,
    "filesSkipped": 1,
    "filesFailed": 0,
    "durationMs": 234
}
```

**Exit codes:** `0` success, `1` complete failure, `3` partial failure (some files ran, some failed).


#### `run file <path>`

Execute a single SQL or `.sql.tmpl` file.

```bash
noorm run file sql/01_tables/001_users.sql
noorm run file seed.sql.tmpl
noorm run file sql/init.sql --json
```

**JSON output:**
```json
{
    "success": true,
    "filepath": "seed.sql",
    "status": "success",
    "checksum": "…",
    "durationMs": 45
}
```


#### `run dir <path>`

Execute all SQL files in a directory in alphabetical order.

```bash
noorm run dir sql/01_tables/
noorm run dir seeds/
noorm run dir migrations/ --json
```

A directory that does not exist, or that holds no SQL files, exits `2` — a directory with nothing in it is a mistyped path, not a successful no-op.


#### `run exec <path>`

Batch-execute SQL files matching a glob pattern or directory. More flexible than `run dir`.

```bash
noorm run exec sql/
noorm run exec "sql/**/*.sql"
noorm run exec "seeds/*.sql" --force
noorm run exec migrations/ --dry-run
```

**Exit codes:** `0` success, `1` complete failure, `2` bad invocation, `3` partial failure.


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
noorm run inspect sql/core/Crons.sql.tmpl --json
```

**JSON output:**
```json
{
    "success": true,
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
noorm run preview sql/seed.sql.tmpl --json
noorm run preview sql/migrations/002.sql.tmpl --config staging
```

**JSON output:**
```json
{
    "success": true,
    "filepath": "sql/schema.sql.tmpl",
    "sql": "CREATE TABLE ...",
    "durationMs": 12
}
```

A missing template exits `2`. In text mode the rendered SQL is the only thing on stdout, so `noorm run preview x.sql.tmpl > rendered.sql` stays pipeable; warnings go to stderr.


### Change Operations

Bare `noorm change` renders citty's help output and does not connect to the database. Use `noorm change list` for the status table.

**Interactive prompts (TTY only).** When you omit the change name on a TTY, `run`, `revert`, `rewind`, `edit`, `rm`, and `history-detail` open a clack picker filtered to the relevant subset:

| Command | Picker includes |
|---------|-----------------|
| `change run` | pending + reverted + stale (not orphaned) |
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
{
    "success": true,
    "changes": [
        {"name": "2024-01-15-init-schema", "status": "success"},
        {"name": "2024-02-01-notifications", "status": "pending"}
    ],
    "pending": 1
}
```


#### `change ff`

Fast-forward: apply all pending changes in order.

```bash
noorm change ff
noorm change ff --dry-run
noorm change ff --force
```

**JSON output:**
```json
{
    "success": true,
    "status": "success",
    "executed": 2,
    "skipped": 0,
    "failed": 0,
    "durationMs": 90,
    "changes": [
        {"name": "2024-02-01-notifications", "status": "success", "durationMs": 45}
    ]
}
```

`--dry-run` adds `"dryRun": true` to the payload. A missing `changes/` directory is a warning, not a failure: it lands in `warnings` rather than making the batch fail.


#### `change next`

Apply the next pending change. An optional positional count applies the next `n` instead of one.

```bash
noorm change next
noorm change next 3
noorm change next --json
```


#### `change run [name]`

Apply a specific change by name. Omit the name on a TTY to pick interactively.

```bash
noorm change run                               # interactive picker (TTY)
noorm change run 2024-02-01-notifications
noorm change run 2024-02-01-notifications --json
```

**JSON output:**
```json
{
    "success": true,
    "name": "2024-02-01-notifications",
    "direction": "change",
    "status": "success",
    "files": [
        {"filepath": "change/001_create-table.sql", "checksum": "a1b2c3", "status": "success", "durationMs": 23}
    ],
    "durationMs": 45
}
```

`direction` is `change` or `revert`. Per-file `status` is one of `pending`, `success`, `failed`, `skipped`; the change-level `status` adds `reverted` and `stale`.


#### `change revert [name]`

Revert a previously applied change by running its rollback SQL. Omit the name on a TTY to pick interactively.

```bash
noorm change revert                              # interactive picker (TTY)
noorm change revert 2024-02-01-notifications
noorm change revert 002_users --json
```


#### `change rewind [name]`

Revert the given change **and every change applied after it**, in reverse order. Omit the name on a TTY to pick interactively.

```bash
noorm change rewind                              # interactive picker (TTY)
noorm change rewind 2024-02-01-notifications
noorm change rewind 001_init --json
```


#### `change add [description]`

Scaffold a new change directory. Omit the description on a TTY to be prompted.

```bash
noorm change add                                # prompts for description (TTY)
noorm change add add-users-table
noorm change add "notification queue" --json
```

Creates `changes/<YYYY-MM-DD>-<slug>/` with `change/` and `revert/` directories, each
holding a `001_<slug>.sql` stub (a single comment naming what belongs there — "Add the SQL
statements that apply this change" / "...undo this change"), plus `changelog.md`. The stub
comments alone don't count as content: running the change before editing them fails with an
actionable message ("Files are empty or contain only template placeholders"), not "change not
found".


#### `change edit [name]`

Open a change folder in `$EDITOR`. Omit the name on a TTY to pick interactively.

```bash
noorm change edit                               # interactive picker (TTY)
noorm change edit 2024-02-01-notifications
EDITOR=vim noorm change edit 001_init
```


#### `change rm [name]`

Remove a change directory from disk. Does **not** touch database state. Gated by the config's `change:rm` access (see [Access Roles](#access-roles) above): `viewer` is denied; `operator` and `admin` confirm via `--yes` or `NOORM_YES=1`. On a TTY, omit the name to pick interactively.

```bash
noorm change rm                                 # picker + confirm (TTY)
noorm change rm 2024-02-01-notifications --yes  # CI
```


#### `change history`

View execution history with timestamps, direction, and duration.

```bash
noorm change history
noorm change history --json
noorm change history --count 50
```

| Flag | Description |
|------|-------------|
| `--count` | Show the last N records (default: 20) |

**JSON output:**
```json
{
    "success": true,
    "history": [
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
}
```


#### `change history-detail [name]`

Per-file execution detail for a single change. Omit the name on a TTY to pick interactively.

```bash
noorm change history-detail                     # interactive picker (TTY)
noorm change history-detail 001_init
noorm change history-detail 002_users --json
```


### Database Operations

#### `db create`

Create the target database if it does not exist. Connects to the dialect's system database (`postgres`, `master`, etc.) to issue the CREATE statement.

```bash
noorm db create
noorm db create -c dev
noorm db create --yes
noorm db create --json
```

Gated by the config's `db:create` access: `viewer` is denied, `operator` needs `--yes` (or `NOORM_YES=1`), `admin` runs unconfirmed. The gate fires before any probe touches the server, so a denied role never gets a SQLite file created as a side effect of the existence check.


#### `db drop`

Drop the entire database.

```bash
noorm db drop --yes
noorm db drop -c dev --yes --json
```

::: danger Destructive
Drops the entire database. Requires `--yes`. Gated by the config's `db:destroy` access: `viewer`/`operator` are denied outright — there is no flag that overrides this — and `admin` still requires confirmation. See [Access Roles](#access-roles) above.
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
noorm db explore triggers               # List triggers
noorm db explore --json                 # JSON overview
```

**JSON output (overview):**
```json
{
    "success": true,
    "tables": 12,
    "views": 3,
    "procedures": 0,
    "functions": 2,
    "types": 4,
    "indexes": 8,
    "foreignKeys": 6,
    "triggers": 1,
    "locks": 0,
    "connections": 3
}
```

`locks` and `connections` are runtime state, not schema, so they appear only in `--json` — the text overview lists the eight counters that have a drill-down subcommand.


#### `db truncate`

Wipe all data from application tables. Schema and noorm tracking tables are preserved.

```bash
noorm db truncate -y
noorm db truncate --dry-run
noorm db truncate --preserve seeds,lookups --yes
noorm db truncate --only users,posts --yes
```

| Flag | Description |
|------|-------------|
| `--preserve` | Comma-separated tables to leave untouched |
| `--only` | Comma-separated tables to truncate, to the exclusion of all others |
| `--dry-run` | List the statements without executing them |

::: warning Access Roles
Gated by the config's `db:truncate` access: `viewer` is denied, `operator` and `admin` both confirm (`--yes`, or `NOORM_YES=1` in CI). There is no `--force` override — see [Access Roles](#access-roles) above.
:::


#### `db teardown`

Drop all database objects.

```bash
noorm db teardown -y
noorm db teardown --dry-run
noorm db teardown --preserve-schemas app_private --yes
```

| Flag | Description |
|------|-------------|
| `--preserve-schemas` | Comma-separated schemas to leave untouched (teardown otherwise reaches every non-system schema) |
| `--dry-run` | Report what would be dropped without dropping it |

A teardown whose post-teardown script failed exits `1` even though the objects are already gone — a half-finished teardown must not report success.

::: warning Access Roles
Gated by the config's `db:teardown` access: `viewer` and `operator` are denied outright, `admin` confirms (`--yes`, or `NOORM_YES=1` in CI). There is no `--force` override — see [Access Roles](#access-roles) above.
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
noorm db transfer --export ./backup/ --passphrase "correct-horse-battery"
noorm db transfer --export ./backup/users.dt --tables users
```

**Import from files:**
```bash
noorm db transfer --import ./backup/users.dt
noorm db transfer --import ./backup/users.dtzx --passphrase "correct-horse-battery" --on-conflict skip
```

`--passphrase` implies encryption, so the export lands as `.dtzx` whether or not you also pass `--compress`. On export it must be at least 12 characters; on import there is no floor, so archives encrypted with an older, shorter passphrase still open. Omit it on a TTY and noorm prompts with masked input; in a non-interactive session or under `--json`, omitting it exits `2`.

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
noorm lock status --json
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
noorm lock acquire --timeout 600000 --reason "nightly migration"
noorm lock acquire --json
```

| Flag | Description |
|------|-------------|
| `--timeout` | Lock duration in milliseconds before it expires (default: 300000) |
| `--reason` | Text shown to anyone this lock blocks |

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

Force release any lock regardless of ownership. Gated by the config's `lock:force` access, which is a confirm cell for both `operator` and `admin`, so `--yes` (or `NOORM_YES=1`) is required.

```bash
noorm lock force --yes
noorm lock force -c prod --yes --json
```

Exits `0` when a lock was actually broken and `2` when there was nothing to release, so a script can tell "evicted a holder" from "no-op" without parsing text. The `--json` payload reports `success` as whether a lock was broken, not whether the command ran.

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
noorm vault init --json
```


#### `vault set <key> [value]`

Store an encrypted secret in the vault.

```bash
noorm vault set API_KEY "sk-live-abc123"
echo "$API_KEY" | noorm vault set API_KEY --stdin
noorm vault set API_KEY "sk-live-abc123" --json
```

| Flag | Description |
|------|-------------|
| `--stdin` | Read the value from stdin instead of argv, so it never reaches the process table, shell history, or a `set -x` trace. Omit the positional value when you pass it |
| `--yes` / `-y` | Confirm the write on a config whose `vault:write` access is a confirm cell (an `operator` user role) |

Upserts: creates if new, updates if the key exists.


#### `vault list`

List all secrets in the vault (keys and metadata only, never values).

```bash
noorm vault list
noorm vault list --json
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

Remove a secret from the vault. `--yes` (or `NOORM_YES=1`) is mandatory: the vault has no soft-delete and no history table, so this destroys the team's only copy.

```bash
noorm vault rm OLD_API_KEY --yes
noorm vault rm OLD_API_KEY --yes --json
```

A key that was never in the vault exits `2`, which is distinct from a delete that failed (`1`).


#### `vault cp <key> <source> <destination>`

Copy one secret from one config's vault to another's. All three arguments are positional and required — there is no bulk mode.

```bash
noorm vault cp API_KEY staging production
noorm vault cp API_KEY staging production --dry-run
noorm vault cp DB_PASSWORD dev staging --force
noorm vault cp API_KEY staging production --json
```

| Flag | Description |
|------|-------------|
| `--force` / `-f` | Overwrite the key if it already exists in the destination |
| `--dry-run` | Preview without executing |

Without `--force`, a key that already exists in the destination is skipped. An unknown source or destination config exits `2`.


#### `vault propagate`

Grant vault access to team members who don't have it yet. Encrypts the vault key with each pending user's public key.

Propagation seals the vault key to a public key and cannot be revoked, so a bare `noorm vault propagate` only *lists* the identities awaiting access and exits `1`. Re-run with `--yes` to grant, or `--to <hash>` to grant to specific identities.

```bash
noorm vault propagate                        # review the pending list
noorm vault propagate --yes                  # grant to everyone pending
noorm vault propagate --to 4a5c14af... --yes # grant to one identity
noorm vault propagate --json
```

| Flag | Description |
|------|-------------|
| `--to` | Comma-separated identity hashes to grant to (default: every pending identity) |
| `--yes` / `-y` | Perform the grant. Without it the command reports and stops |

**JSON output:**
```json
{
    "success": true,
    "granted": true,
    "propagatedTo": ["4a5c14af…"],
    "alreadyHadAccess": 3,
    "failed": [],
    "pending": [
        {"identityHash": "4a5c14af…", "name": "Alice", "email": "alice@example.com"}
    ]
}
```

`propagatedTo` holds identity hashes; `pending` is what maps them back to a name and email. A grant that lands for some identities and not others exits `3` with `success: false` — the vault is in a mixed state, and the teammate whose update did not land believes they have access.


### SQL Operations

#### `sql [query]`

Execute a raw SQL query.

```bash
noorm sql "SELECT * FROM users LIMIT 10"
noorm sql query -f query.sql
noorm sql query -c prod "SELECT count(*) FROM orders"
noorm sql "SELECT id, name FROM users" --json
```

| Flag | Description |
|------|-------------|
| `-f, --file` | Read SQL from a file |
| `-c, --config` | Use specific configuration |

The bare `noorm sql "<SQL>"` form works by rewriting argv to `noorm sql query "<SQL>"`, and it only fires when the first non-flag token after `sql` looks like SQL. A flag that takes a value puts something else there, so `noorm sql -f query.sql` and `noorm sql -c prod "SELECT 1"` print help instead — spell out `query` with either. See [`noorm sql`](./cli/sql.md).

**JSON output:**
```json
{
    "success": true,
    "columns": ["id", "name"],
    "rows": [
        {"id": 1, "name": "Alice"},
        {"id": 2, "name": "Bob"}
    ],
    "durationMs": 12.5
}
```

`rowsAffected` replaces the row payload for INSERT/UPDATE/DELETE and is absent (not `null`) on a SELECT.


#### `sql repl`

Launch the TUI SQL Terminal with multi-line editing, sortable results, and history.

```bash
noorm sql repl
noorm sql repl --config dev
```

**TTY required.** `--yes` / `NOORM_YES` errors with a redirect hint — use `noorm sql query "<SQL>"` or `noorm sql query --file query.sql` for non-interactive SQL.


#### `sql history`

Show SQL execution history. Only the interactive SQL terminal records history — `sql query` deliberately writes none, so persisting query text and returned rows on a build agent never happens.

```bash
noorm sql history
noorm sql history -n 20
noorm sql history --json
noorm sql history -c prod
```

| Flag | Description |
|------|-------------|
| `-n, --limit` | Max entries (default: 50) |


#### `sql clear`

Clear SQL execution history.

```bash
noorm sql clear --yes
noorm sql clear --older-than 3 --yes
noorm sql clear -c prod --yes
```

| Flag | Description |
|------|-------------|
| `--older-than` | Only clear entries older than N months |
| `--yes` / `-y` | Confirm. Without it the command reports what it would clear and exits 0 without clearing |

`--json` also counts as a confirmation, since it is only used non-interactively.


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
noorm info --json
```

**JSON output:**
```json
{
    "success": true,
    "cli_version": "1.0.0-alpha.34",
    "schema_version": 2,
    "state_version": 3,
    "settings_version": 1,
    "installed_at": "2024-01-15T10:30:00.000Z",
    "upgraded_at": null,
    "active_config": "dev",
    "config_count": 2,
    "connection": {
        "host": "localhost",
        "port": 5432,
        "database": "mydb",
        "dialect": "postgres"
    },
    "identity": {
        "name": "Your Name",
        "email": "you@example.com",
        "machine": "laptop",
        "registered_at": "2024-01-15T10:30:00.000Z",
        "last_seen_at": "2024-02-01T09:00:00.000Z"
    },
    "agent": null,
    "objects": {
        "tables": 5,
        "views": 12,
        "functions": 8,
        "procedures": 9,
        "types": 13
    }
}
```

`connection` is `null` and `connection_error` carries the message when the active config can't be reached. `agent` names the AI harness noorm detected, if any, along with the env markers that gave it away — worth checking first when a permission denial has no visible cause, since harness detection is what flips the policy channel from `user` to `agent`.


#### `version`

CLI version and diagnostic information.

```bash
noorm version
noorm version --json
```


#### `update`

Check for and install noorm updates.

```bash
noorm update
noorm update --json
```

| Flag | Description |
|------|-------------|
| `--insecure` | Downgrade an unreachable `checksums.txt` from a failure to a warning. Also settable as `NOORM_INSECURE=1`. It never bypasses a confirmed checksum mismatch, which always fails |


#### `ui`

Launch the interactive terminal UI.

```bash
noorm ui
```

**TTY required.**


## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — everything you asked for happened |
| `1` | Total failure — the operation ran and no unit of work succeeded |
| `2` | Usage error — a bad or missing flag, a TTY-only command run non-interactively, or a named target (file, directory, config, change, secret key, glob) that does not exist. Nothing was attempted, so nothing changed |
| `3` | Partial failure — some units succeeded and some failed. The target is in a mixed state and re-running is not automatically safe |

The split between `1` and `3` is the one that matters in a pipeline: a total
failure can be retried, a partial one needs a human. `2` says the command never
got as far as touching the database.

Policy denials currently exit `1`. They do not yet have a dedicated code.

> **Changed in this release.** `2` previously meant "partial failure" on
> `run build` / `run dir` / `run files` / `run exec` and the five `change`
> execution commands, but the same `2` was also returned for a *total* failure
> on those commands — the two were indistinguishable. Partial now has its own
> code (`3`), total failure reports `1`, and `2` is reserved for a bad
> invocation. A pipeline that tested `[ $? -eq 2 ]` to mean "partially applied"
> must now test `-eq 3`. Checks of the form `if ! noorm …` are unaffected.


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
noorm db explore --json
```


## Output Streams

A command's **result** — the human summary, or the `--json` payload — always goes to
**stdout**. Everything else — progress lines, warnings, the logger's event stream — goes to
**stderr**, in both text and `--json` mode. This holds regardless of whether the command
succeeds or fails: a setup failure (bad config, no connection) prints nothing to stdout in
text mode — the diagnostic goes to stderr — and a single JSON error document to stdout in
`--json` mode, e.g. `{"success":false,"error":"..."}`.

That means `--json` output is always exactly one parseable JSON document on stdout, with no
log noise ahead of or after it — no `tail -1` needed:

```bash
noorm change history --json | jq '.history[0].status'
```

A command that finds nothing to report still writes a result — never silence. `noorm change
list` on a project with no changesets prints `No changes found.` on stdout in text mode and
`{"success":true,"changes":[],"pending":0}` in `--json` mode; either way, a CI step can tell
"ran and found nothing" from "didn't run" by checking the exit code and the (always-present)
stdout line, rather than guessing from empty output.


## The `--json` Envelope

Every `--json` payload is a **JSON object** carrying a top-level boolean `success`.
It is never a bare array. Command-specific fields sit alongside `success`, and
list results live under a key named for the resource:

```json
{ "success": true,  "changes": [ … ], "pending": 0 }
{ "success": true,  "status": "success", "filesRun": 3, "filesSkipped": 0, "filesFailed": 0 }
{ "success": false, "status": "partial", "filesRun": 1, "filesSkipped": 0, "filesFailed": 2 }
{ "success": false, "error": "Template not found: sql/nope.sql.tmpl" }
```

Three guarantees hold across every command:

1. `jq -e '.success'` works everywhere — success and failure alike.
2. `success` and the exit code always agree: `success` is `true` if and only if
   the process exits `0`. A partial result reports `success: false` alongside
   `"status": "partial"` and exit `3`.
3. An unsuccessful payload always carries `error` as a string. That string is a
   message, never a stack trace — stack traces contain absolute filesystem
   paths and stay out of machine-readable output.

Commands that report per-unit outcomes also carry a `status` of `"success"`,
`"partial"`, or `"failed"`, which is what `success` and the exit code are derived
from.

> **Changed in this release.** `--json` success payloads previously had four
> incompatible shapes and no shared discriminator. Two changes are breaking:
> `success` is now present on payloads that had no such key, and the commands
> that returned a **top-level array** now return a named object instead —
> `change list` → `.changes`, `change history` → `.history`, `db explore tables`
> → `.tables`, `views` → `.views`, `indexes` → `.indexes`, `fks` →
> `.foreignKeys`, `functions` → `.functions`, `procedures` → `.procedures`,
> `types` → `.types`, `triggers` → `.triggers`. A script doing `jq '.[]'` on any
> of those must now name the key. Everything else gained a field and lost none.


## Scripting with JSON

```bash
# Check for pending changes
pending=$(noorm change list --json | jq '.pending')
if [ "$pending" -gt 0 ]; then
    echo "Found $pending pending changes"
    noorm change ff
fi
```

```bash
# One failure check that works against every command
if ! noorm run build --json | jq -e '.success' > /dev/null; then
    echo "build did not succeed"
fi
```

```bash
# Get table count
tables=$(noorm db explore --json | jq '.tables')
echo "Database has $tables tables"
```

```bash
# Verify vault access
pending=$(noorm vault list --json | jq '.status.usersWithoutAccess')
if [ "$pending" -gt 0 ]; then
    noorm vault propagate --yes
fi
```

```bash
# Render template and pipe to external tool
noorm run preview sql/hotfix.sql.tmpl | psql -h localhost -d myapp
```
