# CI/CD Automation


Running noorm from an automated pipeline feels a lot like running it on your laptop — the same `run build`, `change ff`, and `db transfer` commands do the same things — but a CI runner has no `.noorm/` directory, no interactive TTY, and no identity on disk. The `noorm ci` namespace exists to close that gap: bootstrap an ephemeral state from environment variables, enroll a long-lived identity once from a developer machine, and let the same commands work in both places.

This guide walks through the two common shapes of CI and the commands that connect them.


## Two Shapes of CI

Not every pipeline needs the same setup. Before writing YAML, decide which of these describes your job:

| | Test CI | Prod CI |
|---|---|---|
| **Database** | Ephemeral (Postgres container, SQLite file, etc.) spun up in the job | Real, shared, already has data |
| **Vault-backed secrets?** | No — templates don't reference `secrets.*` from the vault | Yes — templates decrypt keys at render time |
| **Identity source** | Not required (no vault to decrypt, no audit trail worth sharing) | Required (enrolled once, keeps the audit trail of who deployed what) |
| **`noorm ci init`?** | Optional | **Required** |
| **Where to start** | [Test CI section](#test-ci) | [Prod CI section](#prod-ci) |

When in doubt: if any change or template calls `secrets.KEY` and that key lives in the team vault, you need Prod CI.


## Test CI

The goal is to verify the schema builds and changes apply against a throwaway database. Nothing shared, nothing persisted, nothing secret.

The flow is three env vars and two commands:

```bash
export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_HOST=localhost
export NOORM_CONNECTION_DATABASE=test_db
export NOORM_CONNECTION_USER=postgres
export NOORM_CONNECTION_PASSWORD=test

noorm run build
noorm change ff
```

No identity, no `ci init`, no vault. If the schema compiles and all changes apply cleanly, exit 0.


### GitHub Actions (Test CI)

```yaml
name: Database CI

on:
    pull_request:
        branches: [main]

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
                options: >-
                    --health-cmd pg_isready
                    --health-interval 10s
                    --health-timeout 5s
                    --health-retries 5
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


## Prod CI

When templates render vault-backed secrets or the target config's `access.user` role isn't `admin`, the runner needs two things the test flow skipped:

1. **An identity** — an X25519 keypair whose public key is enrolled in the target database, giving it a slot in the `encrypted_vault_key` column.
2. **A bootstrapped `.noorm/state/state.enc`** — the ephemeral state that every later command expects to find.

The provisioning (step 1) happens once, on a developer machine. The runtime (step 2) happens every job.


### One-Time: Provision the CI Identity

Pick the flow that matches your trust model:

- **In-place** — mint the keypair right on the developer's laptop and grant it vault access. Simplest; the private key never leaves the developer's terminal.
- **Air-gapped** — mint the keypair on one machine, hand the public key to a developer with vault access, and have them enroll just the public half. Use when the machine that will hold the CI private key is different from the one with vault access.


#### In-Place

Run this on a machine that already has vault access on the target config:

```bash
noorm ci identity enroll \
    --config prod \
    --name "GitHub CI" \
    --email ci@example.com \
    --yes
```

`--yes` is required, not optional. Enrollment ends in a `vault:propagate` grant, which the matrix marks `confirm` for every role that holds it, and sealing the vault key to a public key cannot be undone. Without `--yes` (or `NOORM_YES=1`) the command prints the identity it was about to grant to and exits 1 so you can check it first.

The command:

1. Mints a new X25519 keypair.
2. Decrypts the vault key using your own private key.
3. Inserts the new identity row and re-encrypts the vault key for it.
4. **Prints the private key exactly once** — stdout contains `NOORM_IDENTITY_PRIVATE_KEY=<96-hex>`.

Copy the printed block into your CI provider's secret store (GitHub Actions Secrets, GitLab CI Variables, etc.) under whatever name you like. You'll reference it later as `NOORM_IDENTITY_PRIVATE_KEY`.


#### Air-Gapped

On the machine that will hold the CI secret:

```bash
noorm ci identity new --name "GitHub CI" --email ci@example.com --json > ci-identity.json
```

This prints the same env block as `ci identity enroll`, but does not touch any database. Extract the `publicKey` from `ci-identity.json` and send it to someone with vault access on the target config. They run:

```bash
noorm ci identity enroll \
    --config prod \
    --name "GitHub CI" \
    --email ci@example.com \
    --public-key <hex-from-ci-identity.json> \
    --yes
```

Only the public half is enrolled. The private key never leaves the first machine. The public key is 88 hex characters; anything else is rejected before a row is written.

`ci identity enroll` is **idempotent on identityHash** — re-running just ensures vault access, so you can replay it safely if anything fails partway through. It refuses outright when a row already exists under that hash carrying a *different* public key, since granting there would seal the vault key to someone else's key.


### Every Job: Runtime Bootstrap

Inside the CI job, set the three identity env vars plus the connection and call `ci init`:

```bash
noorm ci init --name prod
noorm change ff
```

`ci init` reads `NOORM_IDENTITY_*` and `NOORM_CONNECTION_*`, writes a fresh `.noorm/state/state.enc`, creates a config (default name `ci`, override via `--name` or `NOORM_CI_CONFIG_NAME`), and marks it active. After it runs, every other `noorm` command in the job works exactly as if a developer had bootstrapped the project manually.

If the env vars are missing or malformed, `ci init` exits 2 (bad invocation) before doing anything else. If `state.enc` already exists and `--force` was not passed, it exits 1. With `--force` it backs the old file up next to it first, and from an interactive terminal it also demands `--yes`, since overwriting destroys every config and config-scoped secret in the project.


### Loading Per-Job Secrets

When your templates need secrets that shouldn't live in the vault — one-off job tokens, ephemeral API keys — use `ci secrets` to batch-load them into the active config's vault from a dotenv file:

```bash
cat > ./ci-secrets.env <<EOF
API_KEY=$API_KEY
STRIPE_KEY=$STRIPE_KEY
EOF

noorm ci secrets --file ./ci-secrets.env
rm ./ci-secrets.env
```

Existing keys are skipped by default (so a rerun is safe). Pass `--overwrite` to replace them. Exit codes: `0` clean load, `1` total failure, `2` bad invocation (unknown config, unreadable or malformed `--file`), `3` partial (some keys set, some errored).


### GitHub Actions (Prod CI)

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


### GitHub Actions (Prod CI with job-scoped secrets)

If your changes read vault keys the runner doesn't already have, load them after `ci init`:

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

- name: Load job secrets into vault
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


### GitLab CI (Prod)

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


### Shell Script (Prod, with locking)

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

# Prevent concurrent migrations. `change ff` releases the lock itself once
# the last change lands, so the trap tolerates an already-released lock.
noorm lock acquire
trap 'noorm lock release || true' EXIT

noorm change ff
noorm db explore --json
```


## Reference


### Environment Variables

| Variable | Required for | Description |
|---|---|---|
| `NOORM_IDENTITY_PRIVATE_KEY` | Prod CI | X25519 private key, hex PKCS8 DER (96 hex chars) |
| `NOORM_IDENTITY_NAME` | Prod CI | Display name (e.g. `"GitHub CI"`) |
| `NOORM_IDENTITY_EMAIL` | Prod CI | Email address |
| `NOORM_CI_CONFIG_NAME` | Optional | Default config name for `ci init` |
| `NOORM_YES` | Optional | Truthy value stands in for `--yes` on every command. Truthy is any non-empty value except `0` and `false` |
| `NOORM_CONNECTION_DIALECT` | Always | `postgres`, `mysql`, `sqlite`, or `mssql` |
| `NOORM_CONNECTION_HOST` | Dialect-specific | Host |
| `NOORM_CONNECTION_PORT` | Dialect-specific | Port |
| `NOORM_CONNECTION_DATABASE` | Always | Database name / file path |
| `NOORM_CONNECTION_USER` | Dialect-specific | Username |
| `NOORM_CONNECTION_PASSWORD` | Dialect-specific | Password |


### `ci` Commands at a Glance

| Command | Runs on | Purpose |
|---|---|---|
| `noorm ci identity new` | Developer machine | Mint a CI keypair + print env block. No DB contact. |
| `noorm ci identity enroll --yes` | Developer machine (with vault access) | Enroll a CI identity in a target DB; grant vault access. Idempotent. `--yes` required. |
| `noorm ci init` | CI runner | Bootstrap ephemeral `state.enc` from env; create & activate a config. |
| `noorm ci secrets --file <path>` | CI runner (after `ci init`) | Batch-load secrets from dotenv into the active config. |


### Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success — everything the caller asked for happened |
| `1` | Total failure — the operation ran and no unit of work succeeded |
| `2` | Bad invocation — a missing or malformed flag or env var, or a named target (config, file, change) that does not exist. Nothing was attempted |
| `3` | Partial — some units of work succeeded and some failed. The target is in a mixed state and re-running is not automatically safe |

These four codes are shared by every noorm command, not just `ci`. `2` and `3` are what let a pipeline tell "you named something that isn't there" (retry is pointless) from "half of it landed" (a human needs to look).


## See Also

- [Identity Management](../../cli/identity.md) — keypair model and env-var identity
- [Vault](../environments/vault.md) — how team secrets are encrypted and shared
- [Secrets](../environments/secrets.md) — the three-layer secret resolution hierarchy
- [CI Architecture](../../dev/ci.md) — developer-focused notes on the CI flow
