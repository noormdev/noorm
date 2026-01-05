# Headless Mode


Run noorm without the TUI. Perfect for CI/CD pipelines, scripts, and automation.

```bash
noorm -H run build
noorm -H --json change ff
```


## When It Activates

noorm automatically runs headless when:

| Condition | Headless? |
|-----------|-----------|
| `-H` or `--headless` flag | Yes |
| `NOORM_HEADLESS=true` | Yes |
| CI environment detected | Yes |
| No TTY (piped output) | Yes |
| `-T` or `--tui` flag | No (forces TUI) |

**Detected CI environments:**
- GitHub Actions (`GITHUB_ACTIONS`)
- GitLab CI (`GITLAB_CI`)
- CircleCI (`CIRCLECI`)
- Travis CI (`TRAVIS`)
- Jenkins (`JENKINS_URL`)
- Buildkite (`BUILDKITE`)
- Generic (`CI` or `CONTINUOUS_INTEGRATION`)


## Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--headless` | `-H` | Force headless mode |
| `--tui` | `-T` | Force TUI mode |
| `--json` | — | Output JSON |
| `--config` | `-c` | Config name to use |
| `--force` | `-f` | Skip checksum checks |
| `--yes` | `-y` | Skip confirmations |
| `--dry-run` | — | Preview without executing |


## Configuration


### Using a Stored Config

```bash
# Use active config
noorm -H run build

# Use specific config
noorm -H --config staging run build

# Or via environment
export NOORM_CONFIG=staging
noorm -H run build
```


### Environment-Only Mode

No stored config needed. Set connection via environment variables:

```bash
export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_HOST=db.example.com
export NOORM_CONNECTION_DATABASE=myapp
export NOORM_CONNECTION_USER=deploy
export NOORM_CONNECTION_PASSWORD=$DB_PASSWORD

noorm -H run build
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
NOORM_HEADLESS              # Force headless mode
NOORM_DEBUG                 # Enable debug logging
```


## Commands


### Schema Operations

#### `run build`

Execute all SQL files in the schema directory.

```bash
noorm -H run build
noorm -H --force run build    # Skip checksums, run everything
noorm -H --dry-run run build  # Preview without executing
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

Execute a single SQL file.

```bash
noorm -H run file sql/01_tables/001_users.sql
```


#### `run dir <path>`

Execute all SQL files in a directory.

```bash
noorm -H run dir sql/01_tables/
```


### Change Operations

#### `change`

List all changes with status.

```bash
noorm -H change
```

**Text output:**
```
Changes:
✓ 2024-01-15-init-schema       Applied
✓ 2024-01-20-add-roles         Applied
○ 2024-02-01-notifications     Pending
```

**JSON output:**
```json
[
    {"name": "2024-01-15-init-schema", "status": "applied"},
    {"name": "2024-01-20-add-roles", "status": "applied"},
    {"name": "2024-02-01-notifications", "status": "pending"}
]
```


#### `change ff`

Fast-forward: apply all pending changes.

```bash
noorm -H change ff
noorm -H --dry-run change ff  # Preview only
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


#### `change run <name>`

Apply a specific change.

```bash
noorm -H change run 2024-02-01-notifications
```


#### `change revert <name>`

Revert a specific change.

```bash
noorm -H change revert 2024-02-01-notifications
```


#### `change history`

View execution history.

```bash
noorm -H change history
```


### Database Operations

#### `db explore`

Get schema overview.

```bash
noorm -H db explore
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
noorm -H db explore tables
```


#### `db explore tables detail <name>`

Describe a specific table.

```bash
noorm -H db explore tables detail users
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
noorm -H -y db truncate
```


#### `db teardown`

Drop all database objects.

```bash
noorm -H -y db teardown
```

::: warning Protected Configs
`db teardown` is blocked on protected configs. Use `--force` to override (be careful!).
:::


### Lock Operations

#### `lock status`

Check if database is locked.

```bash
noorm -H lock status
```


#### `lock acquire`

Acquire a lock.

```bash
noorm -H lock acquire --reason "Deploying v2.0"
```


#### `lock release`

Release the lock.

```bash
noorm -H lock release
```


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
          noorm -H run build
          noorm -H change ff
```


### GitLab CI

```yaml
migrate:
  stage: deploy
  image: node:20
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
noorm -H run build

# Apply changes
noorm -H change ff

# Verify
noorm -H --json db explore
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
        noorm -H run build
        noorm -H change ff

    - run: npm test
```


## Scripting with JSON

Parse JSON output for programmatic use:

```bash
# Check if there are pending changes
pending=$(noorm -H --json change | jq '[.[] | select(.status == "pending")] | length')

if [ "$pending" -gt 0 ]; then
    echo "Found $pending pending changes"
    noorm -H change ff
fi
```

```bash
# Get table count
tables=$(noorm -H --json db explore | jq '.tables')
echo "Database has $tables tables"
```
