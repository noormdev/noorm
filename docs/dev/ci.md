# CI/CD Integration


noorm supports two CI patterns: a stateless **test CI** flow (ephemeral database, no secrets) and a vault-aware **prod CI** flow (real database, encrypted secrets). Both are driven entirely by environment variables — no interactive setup, no files checked into the repo.


## Quick Start (Test CI)

For an ephemeral database (spun up inside the CI job), set the connection and run the schema:

```bash
export NOORM_CONNECTION_DIALECT=sqlite
export NOORM_CONNECTION_DATABASE=./tmp/test.db
export NOORM_PATHS_SQL=./sql

noorm run build
```

No identity or `ci init` required. Use this when templates and changes do not reference vault-backed secrets.


## Prod CI (vault-aware)

For a real database where templates read from the vault, use the `ci` namespace:

```bash
# Env: NOORM_IDENTITY_* (private key + name + email) and NOORM_CONNECTION_*
noorm ci init
noorm change ff
```

`noorm ci init` reads identity and connection from env vars, writes an ephemeral `.noorm/state/state.enc`, creates a config (default name `ci`, override with `--name` or `NOORM_CI_CONFIG_NAME`), and marks it active. Later commands in the same job (`run build`, `change ff`, `ci secrets`) operate as if a developer had bootstrapped manually.

**One-time setup** (developer with vault access):

Two approaches depending on your trust model:

```bash
# Option A: Mint + enroll in one step (developer holds vault access)
noorm ci identity enroll --config prod --name "GitHub CI" --email ci@example.com
# → prints NOORM_IDENTITY_PRIVATE_KEY / NAME / EMAIL once; copy to CI secrets store

# Option B: Air-gapped (key minted on a separate machine)
noorm ci identity new --name "GitHub CI" --email ci@example.com --json > ci-key.json
# → gives the public key to a vault-holder, who enrolls it:
noorm ci identity enroll --config prod --name "GitHub CI" --email ci@example.com \
    --public-key <hex from ci-key.json>
```

`ci identity new` never contacts a database — it only generates a keypair and prints the env block. `ci identity enroll` registers the public key in the target database and grants vault access. Both are idempotent on identityHash.

The full flow (with diagrams and per-provider examples) lives in the [CI automation guide](../guide/automation/ci.md).


## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Configuration, connection, or precondition error (missing env vars, missing state, etc.) |
| 2 | Partial success (e.g. `ci secrets` loaded some keys but others errored) or SQL build failure |


## Environment Variables


### Connection

| Variable | Required | Description |
|----------|----------|-------------|
| `NOORM_CONNECTION_DIALECT` | Yes | `sqlite`, `postgres`, `mysql`, or `mssql` |
| `NOORM_CONNECTION_DATABASE` | Yes | Database name or file path |
| `NOORM_CONNECTION_HOST` | No | Database host |
| `NOORM_CONNECTION_PORT` | No | Database port |
| `NOORM_CONNECTION_USER` | No | Database username |
| `NOORM_CONNECTION_PASSWORD` | No | Database password |


### Identity (required for `ci init` and vault-aware flows)

| Variable | Required | Description |
|----------|----------|-------------|
| `NOORM_IDENTITY_PRIVATE_KEY` | Yes | X25519 private key, hex PKCS8 DER (96 hex chars) |
| `NOORM_IDENTITY_NAME` | Yes | Display name (e.g. `"CI Bot"`) |
| `NOORM_IDENTITY_EMAIL` | Yes | Email (e.g. `"ci@example.com"`) |
| `NOORM_CI_CONFIG_NAME` | No | Default config name for `ci init` (override: `--name`) |


### Paths

| Variable | Required | Description |
|----------|----------|-------------|
| `NOORM_PATHS_SQL` | No | Schema directory (default: `./sql`) |
| `NOORM_PATHS_CHANGES` | No | Changes directory (default: `./changes`) |


## GitHub Actions Example (Test CI)

Validates the schema against a fresh SQLite DB, then applies pending changes against Postgres.

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


## GitHub Actions Example (Prod CI with vault)

Same pipeline, but templates need vault-decrypted secrets:

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

- name: Apply changes
  run: npx noorm change ff
```


## Common Commands

| Command | Description |
|---------|-------------|
| `noorm ci init` | Bootstrap ephemeral state from env vars |
| `noorm ci secrets --file <path>` | Batch-load secrets from a dotenv file |
| `noorm run build` | Execute all SQL in schema directory |
| `noorm change ff` | Apply all pending changes |
| `noorm db teardown` | Drop all database objects |


## JSON Output

Use `--json` for structured output:

```bash
noorm --json ci init | jq '.stateFile'
noorm --json run build | jq '.status'
```


## See Also

- [CI Automation Guide](../guide/automation/ci.md) - End-to-end walkthrough with test/prod flows
- [Identity Management](../cli/identity.md) - Keypair model and env-var identity bootstrap
- [CLI Architecture](./headless.md) - How the citty-based command tree is wired together
- [Runner](./runner.md) - Schema execution details
- [Change](./change.md) - Change management
- [Vault](./vault.md) - Encrypted secrets and propagation
