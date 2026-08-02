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

Two preconditions worth knowing before wiring a pipeline:

- It refuses to run when `.noorm/state/state.enc` already exists. `--force` backs the file up and replaces it; from an interactive terminal `--yes` is required as well, since replacing state destroys every config and config-scoped secret in the project.
- The config it writes carries `isTest: true`. An SDK context created with `requireTest: true` will therefore accept it — do not rely on that guard to keep a CI job away from a production database.

**One-time setup** (developer with vault access):

Two approaches depending on your trust model:

```bash
# Option A: Mint + enroll in one step (developer holds vault access)
noorm ci identity enroll --config prod --name "GitHub CI" --email ci@example.com --yes
# → prints NOORM_IDENTITY_PRIVATE_KEY / NAME / EMAIL once; copy to CI secrets store

# Option B: Air-gapped (key minted on a separate machine)
noorm ci identity new --name "GitHub CI" --email ci@example.com --json > ci-key.json
# → gives the public key to a vault-holder, who enrolls it:
noorm ci identity enroll --config prod --name "GitHub CI" --email ci@example.com \
    --public-key <hex from ci-key.json> --yes
```

`ci identity new` never contacts a database — it only generates a keypair and prints the env block. Each run mints a *fresh* keypair, so it is not idempotent; re-running gives a different identity.

`ci identity enroll` registers the public key in the target database and grants vault access. It is idempotent on identityHash: a second run with the same name/email/public key ensures vault access rather than inserting a duplicate. It refuses if a row already exists under that hash with a *different* public key — that shape is a pre-registration attack, not a retry.

`--yes` is required on the first enroll. Enrollment is gated on `vault:propagate`, a `confirm` cell for every role that holds it (`viewer` is denied outright), because sealing the vault key to a public key cannot be undone. Without `--yes` the command prints the identity it is about to grant to and exits 1. It is skipped when the target already holds vault access, since confirming a no-op is noise.

The full flow (with diagrams and per-provider examples) lives in the [CI automation guide](../guide/automation/ci.md).


## Exit Codes

The `ci` commands follow the repo-wide contract in `src/cli/_exit.ts` — the same
codes every other `noorm` command uses:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Total failure — nothing succeeded. `ci init` uses this when `state.enc` already exists without `--force`, or when state/config writes fail. |
| 2 | Usage error — a bad invocation or a named target that does not exist. `ci init` uses this for missing/invalid `NOORM_IDENTITY_*` and missing `NOORM_CONNECTION_DIALECT`/`DATABASE`; `ci secrets` for an unreadable or unparseable `--file` and for an unknown config. Nothing was attempted. |
| 3 | Partial — some units succeeded and some failed, e.g. `ci secrets` set some keys and errored on others. The target is in a mixed state; re-running is not automatically safe. |

`3` rather than `2` for partial is deliberate: a clean failure can be retried,
a partial one needs a human, so the two must never share a code.


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
noorm ci init --json | jq '.stateFile'
noorm run build --json | jq '.status'
```


## See Also

- [CI Automation Guide](../guide/automation/ci.md) - End-to-end walkthrough with test/prod flows
- [Identity Management](../cli/identity.md) - Keypair model and env-var identity bootstrap
- [CLI Architecture](./headless.md) - How the citty-based command tree is wired together
- [Runner](./runner.md) - Schema execution details
- [Change](./change.md) - Change management
- [Vault](./vault.md) - Encrypted secrets and propagation
