---
"@noormdev/cli": minor
---

Introduce the `noorm ci` command namespace and retire the standalone `noorm identity ci` diagnostic.

Four new commands cover the full CI lifecycle — mint a keypair, enroll it in a real database, bootstrap ephemeral state inside a job, and batch-load secrets:

- `noorm ci identity new --name <str> --email <str>` — generate a test-CI keypair locally. No database contact, no state written. Prints the private key once plus a copy-pasteable `NOORM_IDENTITY_*` env block. Designed for stateless/ephemeral CI (`isTest` configs, throwaway databases). Accepts `--json`.
- `noorm ci identity enroll --config <name> --name <str> --email <str> [--public-key <hex>]` — register a CI identity in the target database and propagate vault access to it. Run once by a developer with existing vault access. Decrypts the caller's vault key, inserts a new identity row (`machine='ci'`, `os='env'`), and re-encrypts the vault key for the new identity. Idempotent on identityHash — safe to re-run. When `--public-key` is omitted, mints a new keypair and returns the private key; when provided, only the public half is enrolled (air-gapped flow).
- `noorm ci init [--name <str>] [--force]` — bootstrap ephemeral `state.enc` from `NOORM_IDENTITY_*` + `NOORM_CONNECTION_*` env vars. Runs inside the CI job. Creates a config (default: `ci`, override via `--name` or `NOORM_CI_CONFIG_NAME`), marks it active, sets `isTest: true`. Absorbs the former `noorm identity ci` precheck — fails fast with exit 1 if any required env var is missing or malformed, or if `state.enc` already exists without `--force`.
- `noorm ci secrets --file <path> [--config <name>] [--overwrite]` — batch-load secrets from a dotenv-style file into the active (or `--config`-named) vault. Parser ignores blank lines and `#` comments, splits on the first `=`, and strips a single matched pair of surrounding quotes. Existing keys are skipped unless `--overwrite` is set (so reruns are safe). Exit codes: `0` clean, `1` precondition failure, `2` partial (some set, some errored).

**Removed:** `noorm identity ci`. Its precheck behavior is now built into `noorm ci init`. Callers that used `identity ci` only for validation should replace it with `noorm ci init`, which does the validation plus the state bootstrap.

**Migration:** replace any pipeline that set `NOORM_IDENTITY_*` + `NOORM_CONNECTION_*` and ran `noorm identity ci` followed by `noorm change ff` with:

```bash
noorm ci init --name prod
noorm change ff
```

For vault-aware pipelines, provision the CI identity once from a developer machine:

```bash
noorm ci identity enroll --config prod --name "CI Bot" --email ci@example.com
# copy the printed NOORM_IDENTITY_* block into your CI secrets store
```
