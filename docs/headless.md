# Headless CLI Mode


## Overview

Headless mode runs noorm without the interactive TUI. Use it for:

- **CI/CD pipelines** - Automated deployments with GitHub Actions, GitLab CI, Jenkins
- **Scripts** - Batch operations and tooling
- **Automation** - Scheduled jobs and cron tasks
- **Ephemeral environments** - No stored state needed with env-only mode

In headless mode, noorm executes commands directly, outputs results to stdout, and exits with appropriate codes for scripting.


## Mode Detection

noorm automatically detects when to run headless:

| Condition | Headless? |
|-----------|-----------|
| `--headless` or `-H` flag | Yes |
| `NOORM_HEADLESS=true` env var | Yes |
| CI environment detected | Yes |
| No TTY available | Yes |
| `--tui` or `-T` flag | No (forces TUI) |

**CI environments detected:**
- `CI` or `CONTINUOUS_INTEGRATION`
- `GITHUB_ACTIONS`
- `GITLAB_CI`
- `CIRCLECI`
- `TRAVIS`
- `JENKINS_URL`
- `BUILDKITE`

To force TUI mode in a CI environment (for debugging), use `--tui` or `-T`.


## Command-Line Flags

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--headless` | `-H` | boolean | false | Force headless mode |
| `--tui` | `-T` | boolean | false | Force TUI mode |
| `--json` | - | boolean | false | Output as JSON |
| `--config` | `-c` | string | - | Config name to use (defaults to active config) |
| `--force` | `-f` | boolean | false | Force operation (skip checksums) |
| `--yes` | `-y` | boolean | false | Skip confirmations |
| `--dry-run` | - | boolean | false | Preview without executing |

**Example:**
```bash
noorm -H --json --config prod change ff
```


## Configuration


### Config Resolution

noorm resolves which config to use in this order:

1. `--config` CLI flag
2. `NOORM_CONFIG` env var
3. Active config from state (set via `noorm config use <name>`)

If you've already set an active config in the TUI, headless mode will use it automatically:

```bash
# These are equivalent if 'dev' is the active config
noorm -H change ff
noorm -H --config dev change ff
```


### Using Stored Configs

Specify a config by name using `--config` or the `NOORM_CONFIG` env var:

```bash
# Via flag
noorm -H --config production change ff

# Via env var
export NOORM_CONFIG=production
noorm -H change ff
```


### ENV Variable Overrides

Override any config property via `NOORM_*` environment variables:

```bash
# Override connection host for CI runner
export NOORM_CONNECTION_HOST=db.ci.internal
export NOORM_CONFIG=staging

noorm -H change ff  # Uses staging config with overridden host
```

**Priority** (highest to lowest):
1. `NOORM_*` env vars
2. Stored config
3. Stage defaults
4. Defaults


### Env-Only Mode (No Stored Config)

In ephemeral CI environments without stored configs, run with only ENV vars:

```bash
export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_HOST=db.ci.internal
export NOORM_CONNECTION_DATABASE=myapp_ci
export NOORM_CONNECTION_USER=ci_user
export NOORM_CONNECTION_PASSWORD=$DB_PASSWORD

noorm -H run build  # No --config needed
```

**Minimum required for env-only mode:**
- `NOORM_CONNECTION_DIALECT` (postgres, mysql, sqlite, mssql)
- `NOORM_CONNECTION_DATABASE`

See [Configuration](./config.md) for the full list of supported environment variables.


## Available Commands


### Schema Operations

#### `run build`

Execute all SQL files in the schema directory.

```bash
noorm -H run build
noorm -H --force run build  # Skip checksums
```

**JSON output:**
```json
{
    "status": "success",
    "filesRun": 5,
    "filesSkipped": 2,
    "filesFailed": 0,
    "durationMs": 1234
}
```

#### `run file`

Execute a single SQL file.

```bash
noorm -H run file migrations/001_init.sql
noorm -H --path migrations/001_init.sql run file
```

**JSON output:**
```json
{
    "filepath": "migrations/001_init.sql",
    "status": "success",
    "durationMs": 45
}
```

#### `run dir`

Execute all SQL files in a directory.

```bash
noorm -H run dir migrations/
```


### Changeset Operations

#### `change` (or `change list`)

List changeset status.

```bash
noorm -H change
```

**JSON output:**
```json
[
    { "name": "001_init", "status": "applied", "direction": "forward" },
    { "name": "002_users", "status": "pending", "direction": "forward" }
]
```

#### `change ff`

Fast-forward: apply all pending changesets.

```bash
noorm -H change ff
```

**JSON output:**
```json
{
    "status": "success",
    "executed": 3,
    "skipped": 0,
    "failed": 0,
    "changesets": [
        { "name": "001_init", "status": "success", "durationMs": 45 },
        { "name": "002_users", "status": "success", "durationMs": 123 }
    ]
}
```

#### `change run`

Apply a specific changeset.

```bash
noorm -H change run 001_init
noorm -H --name 001_init change run
```

#### `change revert`

Revert a specific changeset.

```bash
noorm -H change revert 001_init
```

#### `change history`

Get execution history.

```bash
noorm -H change history
noorm -H --count 50 change history  # Last 50 records
```


### Database Operations

#### `db truncate`

Wipe all data, keeping the schema intact.

```bash
noorm -H db truncate
```

**JSON output:**
```json
{
    "truncated": ["users", "posts", "comments"],
    "count": 3
}
```

#### `db teardown`

Drop all database objects (except noorm tracking tables).

```bash
noorm -H db teardown
```

**JSON output:**
```json
{
    "dropped": {
        "tables": 5,
        "views": 2,
        "functions": 3,
        "types": 1
    },
    "count": 11
}
```


### Database Exploration

#### `db explore`

Get database overview with object counts.

```bash
noorm -H db explore
```

**JSON output:**
```json
{
    "tables": 12,
    "views": 3,
    "functions": 5,
    "procedures": 0,
    "types": 2
}
```

#### `db explore tables`

List all tables.

```bash
noorm -H db explore tables
```

**JSON output:**
```json
[
    { "name": "users", "columnCount": 8 },
    { "name": "posts", "columnCount": 5 }
]
```

#### `db explore tables detail`

Describe a specific table.

```bash
noorm -H --name users db explore tables detail
```

**JSON output:**
```json
{
    "name": "users",
    "schema": "public",
    "columns": [
        { "name": "id", "dataType": "integer", "nullable": false, "isPrimaryKey": true },
        { "name": "email", "dataType": "varchar(255)", "nullable": false }
    ]
}
```


### Lock Operations

#### `lock status`

Check current lock status.

```bash
noorm -H lock status
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

Acquire a database lock.

```bash
noorm -H lock acquire
```

#### `lock release`

Release the current lock.

```bash
noorm -H lock release
```


## Output Formats


### Text Output (Default)

Colored console output with status icons:

```
✓ Fast-forward success
  ✓ 001_init 45ms
  ✓ 002_users 123ms
  ✓ 003_posts 89ms
  Executed: 3, Skipped: 0, Failed: 0
```


### JSON Output

Use `--json` for machine-readable output:

```bash
noorm -H --json change ff | jq '.executed'
```

JSON mode disables colors and outputs structured data.


### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Failure |

Always check the exit code in scripts:

```bash
noorm -H change ff || exit 1
```


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
                  node-version: '20'
            - run: npm ci

            - name: Apply migrations
              env:
                  NOORM_CONFIG: production
                  NOORM_CONNECTION_HOST: ${{ secrets.DB_HOST }}
                  NOORM_CONNECTION_PASSWORD: ${{ secrets.DB_PASSWORD }}
              run: noorm -H change ff

            - name: Export schema (optional)
              run: noorm -H --json -c prod db explore > schema.json
```


### GitHub Actions (Env-Only Mode)

For ephemeral environments without stored configs:

```yaml
- name: Apply migrations
  env:
      NOORM_CONNECTION_DIALECT: postgres
      NOORM_CONNECTION_HOST: ${{ secrets.DB_HOST }}
      NOORM_CONNECTION_DATABASE: ${{ secrets.DB_NAME }}
      NOORM_CONNECTION_USER: ${{ secrets.DB_USER }}
      NOORM_CONNECTION_PASSWORD: ${{ secrets.DB_PASSWORD }}
  run: noorm -H change ff
```


### GitLab CI

```yaml
migrate:
    stage: deploy
    script:
        - npm ci
        - noorm -H --config production change ff
    only:
        - main
    environment:
        name: production
```


### Shell Script

```bash
#!/bin/bash
set -e

CONFIG="${1:-}"  # Optional, falls back to active config

echo "Checking for pending changesets..."
PENDING=$(noorm -H --json ${CONFIG:+-c "$CONFIG"} change | jq '[.[] | select(.status=="pending")] | length')

if [ "$PENDING" -gt 0 ]; then
    echo "Applying $PENDING pending changesets..."
    noorm -H ${CONFIG:+-c "$CONFIG"} change ff
else
    echo "Database is up to date"
fi
```


### With Lock Protection

For concurrent deployments, use locks:

```bash
#!/bin/bash
set -e

# Acquire lock (fails if already locked)
noorm -H lock acquire

# Ensure lock is released on exit
trap "noorm -H lock release" EXIT

# Safe to run migrations
noorm -H change ff
```


## Best Practices

1. **Be explicit in CI** - Use `--config` or `NOORM_CONFIG` in CI pipelines for clarity

2. **Use `--json` for scripting** - Easier to parse than text output
   ```bash
   noorm -H --json change | jq '.[] | select(.status=="pending")'
   ```

3. **Check exit codes** - Non-zero means failure
   ```bash
   noorm -H change ff || { echo "Migration failed"; exit 1; }
   ```

4. **Use locks for concurrent operations** - Prevent race conditions in parallel deployments

5. **Use env vars for credentials** - Never hardcode secrets
   ```bash
   export NOORM_CONNECTION_PASSWORD="$DB_PASSWORD"
   ```

6. **Test with `--dry-run`** - Preview operations before executing
   ```bash
   noorm -H --dry-run change ff
   ```

7. **Capture logs** - noorm appends to `.noorm/noorm.log` for debugging


## Error Messages

Common errors and their meanings:

| Error | Cause | Solution |
|-------|-------|----------|
| `No config available` | No config, env var, or active config | Set `--config`, `NOORM_CONFIG`, or run `noorm config use <name>` |
| `Config 'x' not found` | Named config doesn't exist | Check config name or use env-only mode |
| `Connection refused` | Database unreachable | Verify host, port, and network access |
| `Lock held by x` | Another process has the lock | Wait or investigate the lock holder |
| `Changeset 'x' not found` | Named changeset doesn't exist | Check changeset name |


## Command Syntax

Commands use space-separated subcommands:

```bash
# Primary syntax (space notation)
noorm -H change ff
noorm -H db explore tables detail

# Parameters via flags
noorm -H --name users db explore tables detail

# Parameters as arguments
noorm -H db explore tables detail users

# Alternative: colon notation
noorm -H change:ff
noorm -H db:explore

# Alternative: slash notation (internal representation)
noorm -H change/ff
```
