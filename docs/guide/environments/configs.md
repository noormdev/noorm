# Configs


You need to connect to different databases. Your local dev database uses SQLite. Staging runs PostgreSQL on a remote server. Production is locked down tight. noorm handles all of this with configs.

A **config** is a saved database connection with all its details: dialect, host, credentials, paths. You create configs once, then switch between them as needed.


## Why Multiple Configs?

Real projects talk to multiple databases:

- `dev` - Your local machine, fast iteration
- `test` - Gets wiped between test runs
- `staging` - Mirrors production, catches issues early
- `prod` - The real thing, locked down by access roles

Without saved configs, you'd type connection details every time. With them, you switch environments in one keystroke.


## Creating a Config (TUI)

Launch the TUI and navigate to configs:

```bash
noorm
```

Press `c` to open the config menu, then `a` to add a new config.

The setup wizard walks you through each field:

1. **Config Name** - A short identifier like `dev`, `staging`, or `prod`. Use lowercase with hyphens.

2. **Database Type** - Your database engine: PostgreSQL, MySQL, SQLite, or SQL Server.

3. **Host** - The server address. For local databases, this is usually `localhost`. SQLite doesn't need a host.

4. **Port** - The port number. noorm fills in the default for your dialect (PostgreSQL: 5432, MySQL: 3306, MSSQL: 1433).

5. **Database** - The database name, or file path for SQLite.

6. **Username** and **Password** - Your credentials. Passwords are stored encrypted.

7. **User Role** and **Agent Role** - Who may do what through this config. See [Access Roles](#access-roles) below.

8. **Test Database** - Marks the config as a test target, which build rules and the SDK's `requireTest` guard read.

Before saving, noorm connects to the server to check the credentials. It uses the dialect's system database, so the target database does not have to exist yet. Schema and change directories are not part of a config: they come from `paths` in `settings.yml`.


## Creating a Config Non-Interactively

`noorm config add` and `edit` do not run headlessly. They print the interactive-only message and exit non-zero, because credential entry and the connection test belong in the wizard. Two commands are the exception: `noorm config rm <name> --yes` deletes headlessly (see the [CLI Reference](/headless#config-rm-name)), and `noorm config import <file>` creates or replaces a config from JSON. For CI/CD pipelines and scripts that need to skip the config wizard entirely, build the config from **environment variables** instead:

```bash
export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_HOST=db.staging.example.com
export NOORM_CONNECTION_PORT=5432
export NOORM_CONNECTION_DATABASE=myapp_staging
export NOORM_CONNECTION_USER=deploy
export NOORM_CONNECTION_PASSWORD="$DB_PASSWORD"

noorm run build       # Uses the env-only config
noorm change ff       # Same — no stored config required
```

When at least `NOORM_CONNECTION_DIALECT` and `NOORM_CONNECTION_DATABASE` are set, noorm runs without ever touching `.noorm/state/state.enc`. See the [CLI Reference](/headless#environment-only-mode) for the full list of supported variables.


## Switching Configs

Only one config is active at a time. All commands use the active config unless you specify otherwise.

**In the TUI:** Press `c` for configs, highlight one in the list, then press `Enter` to activate it.

**From the command line:**

```bash
noorm config use staging
```

**Per-command override:**

```bash
noorm -c prod run build
```

`noorm config list` marks the active one and tags anything whose access is no longer the default:

```
Configurations:
  dev (active) — sqlite/./data/dev.db
  staging — postgres/staging_db
  prod — postgres/prod_db [user:operator agent:off]
```


## Config Properties

Every config has these fields:

| Property | Required | Description |
|----------|----------|-------------|
| `name` | Yes | Unique identifier (alphanumeric, hyphens, underscores) |
| `type` | Yes | `local` or `remote` |
| `dialect` | Yes | `postgres`, `mysql`, `sqlite`, or `mssql` |
| `host` | No* | Server address (*required for non-SQLite) |
| `port` | No | Port number (defaults by dialect) |
| `database` | Yes | Database name or file path |
| `user` | No | Authentication username |
| `password` | No | Authentication password (stored encrypted) |
| `access.user` | No | CLI/TUI/SDK role: `viewer`, `operator`, or `admin` (default: `admin`) |
| `access.agent` | No | AI agent role, over MCP and the CLI alike: `viewer`, `operator`, `admin`, or `false` to hide the config from agents (default: `viewer`) |
| `isTest` | No | Marks as test database (default: false) |
| `ssl` | No | SSL/TLS configuration |
| `pool` | No | Connection pool settings |
| `identity` | No | Override the audit identity |

Connection details nest under a `connection` object in the stored JSON, so `host` is `connection.host` and `ssl` is `connection.ssl`. `name`, `type`, `isTest`, `access`, and `identity` sit at the top level.

**Default ports by dialect:**

| Dialect | Default Port |
|---------|--------------|
| PostgreSQL | 5432 |
| MySQL | 3306 |
| MSSQL | 1433 |
| SQLite | N/A |


## Access Roles

Production databases need safeguards. Every config carries an access role per **channel** — who's *driving*. `noorm ui` → Config → Edit sets `access.user` (a human) and `access.agent` (an AI agent) independently, so a config can be wide open to you at the terminal while showing an agent only read access.

The channel is the caller, not the transport. An agent reaches noorm over MCP or by running `noorm` on the command line, and both get the `agent` role — the CLI recognizes the agent harness it was spawned from, so an agent that is refused over MCP cannot route around it by shelling out.

| Role | Behavior |
|------|----------|
| `viewer` | Read-only: explore schema, run `SELECT`/`EXPLAIN`. Cannot read secrets |
| `operator` | Reads plus writes; migrations, builds, and `db create`/`db reset` require typing a confirmation phrase; raw DDL, `db drop`, and `db teardown` are denied |
| `admin` | Everything is permitted, but the operations that cannot be walked back still prompt |

| Operation | viewer | operator | admin |
|-----------|--------|----------|-------|
| `db explore`, `SELECT` / `EXPLAIN` | allowed | allowed | allowed |
| Raw `INSERT` / `UPDATE` / `DELETE` | denied | allowed | allowed |
| Raw DDL (`CREATE` / `ALTER` / `DROP`) | denied | denied | allowed |
| `change run` / `change ff` / `change revert` | denied | confirm | allowed |
| `run build` / `run file` / `run dir` | denied | confirm | allowed |
| `db create` / `db reset` | denied | confirm | allowed |
| `db truncate` | denied | confirm | confirm |
| `db drop` / `db teardown` | denied | denied | confirm |
| `change rm`, `config rm`, overwriting a config | denied | confirm | confirm |
| Reading vault or local secrets | denied | allowed | allowed |
| Writing vault or local secrets | denied | confirm | allowed |
| `vault propagate` | denied | confirm | confirm |

`admin` is not a bypass. Dropping a database, tearing down a schema, truncating tables, removing a change or a config, overwriting a config's access roles, and propagating the vault key all confirm at every role that is allowed to attempt them. The full matrix lives in `src/core/policy/matrix.ts`.

When an operation needs confirmation in the TUI, noorm asks you to type a phrase (`yes-<config-name>`). This catches the "oops, wrong database" moment before damage happens.

**Skipping confirmations in CI:**

Automated pipelines can't type confirmations. Set `NOORM_YES=1` to skip them on the `user` channel:

```bash
export NOORM_YES=1
noorm -c prod change run
```

There is no equivalent skip on the `agent` channel — an agent hitting a `confirm` cell is always denied, and `NOORM_YES` / `--yes` do not change that. Otherwise the confirmation would be one flag away from meaningless. See [MCP](/guide/automation/mcp#access-roles) for the agent-facing side of this.

**Which channel am I on?**

noorm resolves the channel from the environment it was started in, in this order:

1. `NOORM_CHANNEL=user` or `NOORM_CHANNEL=agent`, if set.
2. The variables agent harnesses export for their child processes — Claude Code, OpenAI Codex, Cursor, Gemini CLI, or the generic `AI_AGENT` / `NOORM_AGENT`. Any of those means `agent`.
3. Otherwise `user`.

`TERM_PROGRAM`, `CI`, and whether stdout is a TTY are deliberately ignored: they describe the terminal or the pipeline, not the caller, and keying on them would lock a human out of their own CLI.

`noorm mcp serve` sits above this chain. It declares `agent` outright, so stdio traffic stays on the agent channel even under `NOORM_CHANNEL=user`.

Set `NOORM_CHANNEL=user` when *you* are scripting from inside an agent session and want your own role:

```bash
NOORM_CHANNEL=user noorm -c prod change run
```

::: warning Access Roles Are Not Security
Roles prevent accidents, not attacks. They won't stop a determined user or malicious script — an agent can set `NOORM_CHANNEL` too. The channel defends against an agent routing around a refusal, which is the realistic case, not one setting out to evade the check. Use proper database permissions for real security.
:::


## Environment Variable Overrides

Environment variables override stored config values. This is how you inject secrets in CI/CD without storing them.

**Connection variables:**

| Variable | Config Path |
|----------|-------------|
| `NOORM_CONNECTION_DIALECT` | `connection.dialect` |
| `NOORM_CONNECTION_HOST` | `connection.host` |
| `NOORM_CONNECTION_PORT` | `connection.port` |
| `NOORM_CONNECTION_DATABASE` | `connection.database` |
| `NOORM_CONNECTION_USER` | `connection.user` |
| `NOORM_CONNECTION_PASSWORD` | `connection.password` |
| `NOORM_CONNECTION_SSL` | `connection.ssl` |

**Path variables.** These two override `settings.yml`, not the config, because schema and change directories are project-wide:

| Variable | Settings Path |
|----------|---------------|
| `NOORM_PATHS_SQL` | `paths.sql` |
| `NOORM_PATHS_CHANGES` | `paths.changes` |

The overlay stays out of the file itself. noorm never writes an ambient `NOORM_*` value back into `settings.yml`, which is version controlled.

**Behavior variables:**

| Variable | Purpose |
|----------|---------|
| `NOORM_CONFIG` | Which config to use |
| `NOORM_YES` | Skip confirmations (set to `1`) |
| `NOORM_CHANNEL` | Force the policy channel: `user` or `agent` (default: detected from the environment) |

**Example: Override host for CI runner**

```bash
# Use stored 'staging' config but connect to CI database server
export NOORM_CONFIG=staging
export NOORM_CONNECTION_HOST=db.ci-runner.internal
noorm run build
```

**Example: Build config entirely from environment**

When you provide at least `NOORM_CONNECTION_DIALECT` and `NOORM_CONNECTION_DATABASE`, noorm creates a temporary config from environment variables alone:

```bash
export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_HOST=localhost
export NOORM_CONNECTION_DATABASE=ci_test
export NOORM_CONNECTION_USER=postgres
export NOORM_CONNECTION_PASSWORD="$DB_PASSWORD"

noorm run build  # Uses env-only config
```


## Validating Connections

Before running changes, verify your config connects successfully. In the TUI, highlight a config, press `+` for More, then press `v` to run a full validation:

1. Can noorm connect with the provided credentials?
2. Does the target database exist?
3. Are the sql/changes paths accessible?

The TUI also offers a **server-only** mode that skips the database existence check by connecting to the dialect's system database (PostgreSQL uses `postgres`, MSSQL uses `master`). Use it during initial setup, before the target database is created.

For headless smoke checks, run any command that opens a connection — e.g. `noorm info` or `noorm db explore` — and inspect the exit code or `--json` output.


## Exporting and Importing Configs

There are two export paths, and they produce different files.

**TUI, for sharing with a teammate:** `noorm ui` → Config → `+` for More → `x` exports the highlighted config, `i` imports one. This path encrypts the config and its local secrets for a single recipient, using an ephemeral X25519 key exchange and AES-256-GCM, and writes `<name>.noorm.enc`. It leaves `user` and `password` out on purpose, so the recipient connects with their own credentials. You need the recipient's identity locally before you can export to them, and only their private key can decrypt the file. On import, noorm decrypts with your private key and prompts for your database credentials.

**CLI, for backup and cross-machine transfer:** `noorm config export` writes plain JSON, and that JSON carries the connection password. Treat the file as a credential. noorm writes it with `0600` permissions and requires a role that can read secrets, so a `viewer` is refused.

```bash
# Export to stdout or file
noorm config export dev
noorm config export dev --output ./dev-config.json

# Import from file
noorm config import ./dev-config.json
noorm config import ./staging-config.json --force --yes   # overwrite existing
```

The exported JSON looks like this:

```json
{
    "name": "dev",
    "type": "local",
    "isTest": false,
    "access": {
        "user": "admin",
        "agent": "viewer"
    },
    "connection": {
        "dialect": "sqlite",
        "database": "./data/dev.db"
    }
}
```

Overwriting an existing config rewrites its access roles, so `--force` on its own is not enough: `config import` also wants `--yes` (or `NOORM_YES`) to confirm. When you import a file that has no credentials in it, set the password afterward through the TUI's edit screen or with `NOORM_CONNECTION_PASSWORD` at command time.


## Managing Configs from the CLI

noorm also has headless commands for scripting and CI:

```bash
# List all configs
noorm config list
noorm config list --json

# Copy a config
noorm config cp dev staging

# Validate connection
noorm config validate prod

# Export and import (see above)
noorm config export dev --output ./backup.json
noorm config import ./backup.json
```

`config validate` connects to the database and exits 0 on success, 1 on failure. Use it as a CI health check before running migrations.


## Common Workflows


### Setting Up a New Developer

1. Clone the repository
2. Run `noorm ui` and import the shared config under Config → `+` → `i`
3. Edit the imported config and set the password (Config → highlight → `e`)
4. Back on the config list, press `+` then `v` to validate the connection


### CI/CD Pipeline

```yaml
# GitHub Actions example
env:
    NOORM_CONNECTION_DIALECT: postgres
    NOORM_CONNECTION_HOST: ${{ secrets.DB_HOST }}
    NOORM_CONNECTION_DATABASE: ${{ secrets.DB_NAME }}
    NOORM_CONNECTION_USER: ${{ secrets.DB_USER }}
    NOORM_CONNECTION_PASSWORD: ${{ secrets.DB_PASSWORD }}
    NOORM_YES: 1

steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - run: noorm run build
    - run: noorm change run
```


### Switching Between Dev and Staging

```bash
# Morning: work on local
noorm config use dev
noorm run build

# Afternoon: deploy to staging
noorm config use staging
noorm change run
```

Or use per-command overrides without switching:

```bash
noorm -c staging change run
```


## What's Next?

- [Stages](/guide/environments/stages) - Config templates for teams
- [Secrets](/guide/environments/secrets) - Managing sensitive values
- [CLI Reference](/headless) - Environment variables and command surface for CI/CD
