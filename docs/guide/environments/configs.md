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

1. **Name** - A short identifier like `dev`, `staging`, or `prod`. Use lowercase with hyphens.

2. **Type** - Choose `local` for your machine or `remote` for servers.

3. **Dialect** - Your database engine: `postgres`, `mysql`, `sqlite`, or `mssql`.

4. **Host** - The server address. For local databases, this is usually `localhost`. SQLite doesn't need a host.

5. **Port** - The port number. noorm fills in the default for your dialect (PostgreSQL: 5432, MySQL: 3306, MSSQL: 1433).

6. **Database** - The database name, or file path for SQLite.

7. **User** and **Password** - Your credentials. Passwords are stored encrypted.

8. **Paths** - Where your schema and change files live.

After completing the wizard, noorm validates the connection. If it succeeds, your config is saved.


## Creating a Config Non-Interactively

`noorm config add`, `edit`, and `rm` all launch the TUI wizard — they exist to guide credential entry interactively. For CI/CD pipelines and scripts that need to skip the wizard entirely, build the config from **environment variables** instead:

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

**In the TUI:** Press `c` for configs, select one from the list, then press `u` to use it.

**From the command line:**

```bash
noorm config use staging
```

**Per-command override:**

```bash
noorm -c prod run build
```

The active config shows with a dot in listings:

```
Configs
  * dev        sqlite   ./data/dev.db
    staging    postgres db.staging.example.com
    prod       postgres db.prod.example.com
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
| `access.mcp` | No | MCP role: `viewer`, `operator`, `admin`, or `false` to hide from MCP (default: `admin`) |
| `isTest` | No | Marks as test database (default: false) |
| `ssl` | No | SSL/TLS configuration |
| `pool` | No | Connection pool settings |
| `identity` | No | Override the audit identity |

**Default ports by dialect:**

| Dialect | Default Port |
|---------|--------------|
| PostgreSQL | 5432 |
| MySQL | 3306 |
| MSSQL | 1433 |
| SQLite | N/A |


## Access Roles

Production databases need safeguards. Every config carries an access role per **channel** — who's asking. `noorm ui` → Config → Edit sets `access.user` (the CLI/TUI/SDK) and `access.mcp` (an AI agent connected via MCP) independently, so a config can be wide open to you at the terminal while showing an agent only read access.

| Role | Behavior |
|------|----------|
| `viewer` | Read-only: explore schema, run `SELECT`/`EXPLAIN` |
| `operator` | Reads plus writes; destructive operations (`change run/ff/revert`, `run build`, `db create`/`db reset`) require typing a confirmation phrase; `db drop` is denied |
| `admin` | Frictionless — everything allowed, nothing prompts |

| Operation | viewer | operator | admin |
|-----------|--------|----------|-------|
| `change run` / `change ff` / `change revert` | denied | confirm | allowed |
| `run build` | denied | confirm | allowed |
| `db create` | denied | confirm | allowed |
| `db teardown` | denied | confirm | allowed |
| `db drop` | denied | denied | confirm |

When an `operator`-role operation needs confirmation in the TUI, noorm asks you to type a phrase (`yes-<config-name>`). This catches the "oops, wrong database" moment before damage happens.

**Skipping confirmations in CI:**

Automated pipelines can't type confirmations. Set `NOORM_YES=1` to skip them on the `user` channel:

```bash
export NOORM_YES=1
noorm -c prod change run
```

There is no equivalent skip on the MCP channel — an agent hitting a `confirm` cell always gets denied, redirected to the CLI. See [MCP](/guide/automation/mcp#access-roles) for the agent-facing side of this.

::: warning Access Roles Are Not Security
Roles prevent accidents, not attacks. They won't stop a determined user or malicious script. Use proper database permissions for real security.
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

**Path variables:**

| Variable | Config Path |
|----------|-------------|
| `NOORM_PATHS_SQL` | `paths.sql` |
| `NOORM_PATHS_CHANGESETS` | `paths.changes` |

**Behavior variables:**

| Variable | Purpose |
|----------|---------|
| `NOORM_CONFIG` | Which config to use |
| `NOORM_YES` | Skip confirmations (set to `1`) |
| `NOORM_JSON` | JSON output mode (set to `1`) |

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

Before running changes, verify your config connects successfully. In the TUI, select a config and press `v` to run a full validation:

1. Can noorm connect with the provided credentials?
2. Does the target database exist?
3. Are the sql/changes paths accessible?

The TUI also offers a **server-only** mode that skips the database existence check by connecting to the dialect's system database (PostgreSQL uses `postgres`, MSSQL uses `master`). Use it during initial setup, before the target database is created.

For headless smoke checks, run any command that opens a connection — e.g. `noorm info` or `noorm db explore` — and inspect the exit code or `--json` output.


## Exporting and Importing Configs

You can export configs to share across team members or machines.

**TUI:** `noorm ui` → Config → press `x` to export the highlighted config or `i` to import one.

**CLI:**

```bash
# Export to stdout or file
noorm config export dev
noorm config export dev --output ./dev-config.json

# Import from file
noorm config import ./dev-config.json
noorm config import ./staging-config.json --force   # overwrite existing
```

Exports strip passwords and other sensitive fields. The exported JSON looks like this:

```json
{
    "name": "dev",
    "type": "local",
    "dialect": "sqlite",
    "database": "./data/dev.db",
    "paths": {
        "schema": "./sql",
        "changes": "./changes"
    }
}
```

After importing, set passwords or secrets separately: through the TUI's edit screen or with `NOORM_CONNECTION_PASSWORD` at command time.


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
2. Run `noorm ui` and import the shared config template under Config → `i`
3. Edit the imported config and set the password (Config → highlight → `e`)
4. Press `v` on the same screen to validate the connection


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
