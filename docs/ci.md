# CI/CD Integration


## Quick Start

noorm validates your database schema in CI using headless mode. Set environment variables and run the build command:

```bash
export NOORM_CONNECTION_DIALECT=sqlite
export NOORM_CONNECTION_DATABASE=./tmp/test.db
export NOORM_PATHS_SCHEMA=./schema

noorm -H run build
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
| `NOORM_PATHS_SCHEMA` | No | Schema directory (default: `./schema`) |


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
                  NOORM_PATHS_SCHEMA: ./schema
              run: |
                  mkdir -p ./tmp
                  npx noorm -H run build

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

            - name: Apply migrations
              env:
                  NOORM_CONNECTION_DIALECT: postgres
                  NOORM_CONNECTION_HOST: ${{ secrets.DB_HOST }}
                  NOORM_CONNECTION_DATABASE: ${{ secrets.DB_NAME }}
                  NOORM_CONNECTION_USER: ${{ secrets.DB_USER }}
                  NOORM_CONNECTION_PASSWORD: ${{ secrets.DB_PASSWORD }}
              run: npx noorm -H change ff
```


## Common Commands

| Command | Description |
|---------|-------------|
| `noorm -H run build` | Execute all SQL in schema directory |
| `noorm -H change ff` | Apply all pending changesets |
| `noorm -H db teardown` | Drop all database objects |


## JSON Output

Use `--json` for structured output:

```bash
noorm -H --json run build | jq '.status'
```


## See Also

- [Headless Mode](./headless.md) - Complete CLI reference for automation
- [Runner](./runner.md) - Schema execution details
- [Changeset](./changeset.md) - Migration management
