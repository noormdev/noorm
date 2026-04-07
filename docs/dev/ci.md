# CI/CD Integration


## Quick Start

Every `noorm` command runs headlessly by default — there is no mode flag or interactive TTY check. Set the connection via environment variables and invoke the build command straight from your pipeline:

```bash
export NOORM_CONNECTION_DIALECT=sqlite
export NOORM_CONNECTION_DATABASE=./tmp/test.db
export NOORM_PATHS_SQL=./sql

noorm run build
```

If the schema has SQL errors, the command exits with code 2. Valid schemas exit with code 0.


## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Configuration or connection error |
| 2 | Build failure (SQL syntax error) |


## Environment Variables

Configure noorm entirely through environment variables - no stored config needed:

| Variable | Required | Description |
|----------|----------|-------------|
| `NOORM_CONNECTION_DIALECT` | Yes | `sqlite`, `postgres`, `mysql`, or `mssql` |
| `NOORM_CONNECTION_DATABASE` | Yes | Database name or file path |
| `NOORM_CONNECTION_HOST` | No | Database host |
| `NOORM_CONNECTION_PORT` | No | Database port |
| `NOORM_CONNECTION_USER` | No | Database username |
| `NOORM_CONNECTION_PASSWORD` | No | Database password |
| `NOORM_PATHS_SQL` | No | Schema directory (default: `./sql`) |


## GitHub Actions Example

```yaml
name: Database CI

on:
    push:
        branches: [main]
    pull_request:
        branches: [main]

jobs:
    validate:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4

            - uses: actions/setup-node@v4
              with:
                  node-version: '20'

            - run: npm ci

            - name: Validate schema
              env:
                  NOORM_CONNECTION_DIALECT: sqlite
                  NOORM_CONNECTION_DATABASE: ./tmp/validate.db
                  NOORM_PATHS_SQL: ./sql
              run: |
                  mkdir -p ./tmp
                  npx noorm run build

    deploy:
        runs-on: ubuntu-latest
        needs: validate
        if: github.ref == 'refs/heads/main'
        steps:
            - uses: actions/checkout@v4

            - uses: actions/setup-node@v4
              with:
                  node-version: '20'

            - run: npm ci

            - name: Apply changes
              env:
                  NOORM_CONNECTION_DIALECT: postgres
                  NOORM_CONNECTION_HOST: ${{ secrets.DB_HOST }}
                  NOORM_CONNECTION_DATABASE: ${{ secrets.DB_NAME }}
                  NOORM_CONNECTION_USER: ${{ secrets.DB_USER }}
                  NOORM_CONNECTION_PASSWORD: ${{ secrets.DB_PASSWORD }}
              run: npx noorm change ff
```


## Common Commands

| Command | Description |
|---------|-------------|
| `noorm run build` | Execute all SQL in schema directory |
| `noorm change ff` | Apply all pending changes |
| `noorm db teardown` | Drop all database objects |


## JSON Output

Use `--json` for structured output:

```bash
noorm --json run build | jq '.status'
```


## See Also

- [CLI Architecture](./headless.md) - How the citty-based command tree is wired together
- [Runner](./runner.md) - Schema execution details
- [Change](./change.md) - Change management
