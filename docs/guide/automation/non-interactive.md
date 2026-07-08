# Non-interactive operation


CI runners, deploy scripts, and AI subagents don't get to "press Enter".
noorm's CLI defaults to assuming a human is at the keyboard for a
handful of commands; the universal `--yes` / `NOORM_YES` opt-in tells
those commands to stop asking.

`--yes` does not mean "do anything regardless." It means: "use defaults,
don't prompt, fail loudly if a non-interactive path doesn't exist for
this command."


## The opt-in


### Flag form

Every TTY-gated command accepts `--yes` (alias `-y`):

    noorm init --yes


### Environment form

`NOORM_YES` is equivalent and applies to every command at once. Useful in
CI where you set it once at the top of the pipeline.

    export NOORM_YES=1
    noorm init
    noorm change ff
    noorm db reset

Truthy values: `1`, `true`, `yes`, `TRUE`, any non-empty string. Falsy
values: `0`, `false`, empty string, unset. The comparison for `false` is
case-insensitive.

The `--yes` flag wins over `NOORM_YES=0`. Use that if you want to override
a globally-set falsy default.


## What `--yes` does per command

Some commands have a genuine non-interactive equivalent — for those,
`--yes` succeeds. The rest are interactive by design; for them, `--yes`
errors fast and points at the headless alternative.


### Accepts `--yes` (proceeds)

| Command | Behavior with `--yes` |
|---------|-----------------------|
| `noorm init` | Skips all prompts. Requires an existing identity at `~/.noorm/identity.{key,pub,json}`. Errors with a bootstrap hint if missing. |


### Refuses `--yes` (redirect hint)

| Command | Redirect |
|---------|----------|
| `noorm sql repl` | Use `noorm sql query "<SQL>"` or `noorm sql query --file query.sql`. |
| `noorm settings edit` | Edit `settings.yml` directly; run `noorm settings build` to validate. |
| `noorm settings secret` | Edit the `secrets:` section of `settings.yml` directly. For values, use `noorm secret set <key> <value>`. |

These commands exit 1 with the redirect message on stderr. Same exit
code as the TTY refusal, so existing CI checks don't change behavior.


### Already non-interactive (no `--yes` needed)

These accept explicit flags and don't gate on a TTY:

- `noorm identity init --name "..." --email "..."` — bootstraps the identity used by `noorm init --yes`.
- `noorm config import <path>` — wizard-free config setup.
- `noorm ci init` / `ci secrets` / `ci identity new` / `ci identity enroll` — the dedicated CI bootstrap surface.


## CI bootstrap pipeline

End-to-end happy path: from a clean machine to a usable noorm project,
with no prompts:

    #!/usr/bin/env bash
    set -euo pipefail

    # 1. Identity (once per machine; idempotent if files exist + --force).
    noorm identity init \
      --name "$CI_USER" \
      --email "$CI_EMAIL"

    # 2. Project scaffold (sql/, changes/, settings.yml, state.enc).
    cd "$PROJECT_ROOT"
    noorm init --yes

    # 3. Connection config — env-only, no wizard.
    export NOORM_CONNECTION_DIALECT=postgres
    export NOORM_CONNECTION_HOST="$DB_HOST"
    export NOORM_CONNECTION_DATABASE="$DB_NAME"
    export NOORM_CONNECTION_USER="$DB_USER"
    export NOORM_CONNECTION_PASSWORD="$DB_PASSWORD"

    # 4. Build schema + apply pending changes.
    noorm run build
    noorm change ff

If you need a stored config (rather than env-only), use `noorm config
import <path>` with a pre-built JSON file. See
[`docs/headless.md`](../../headless.md) for the full env-only matrix.


## When `--yes` is NOT enough

`--yes` covers prompts. It does NOT relax safety gates that exist for
destructive operations:

- `noorm db drop`, `noorm db reset`, `noorm db teardown` still require `--yes` *or* `--force` per their own contracts. `NOORM_YES=1` does count toward those gates.
- Every destructive command is also gated by the config's access role (`viewer`/`operator`/`admin` — see [Access Roles](../../headless.md#access-roles)). `--yes`/`NOORM_YES=1` only skips an `operator` confirmation prompt; it cannot open a `deny` cell. A `viewer`-role config still refuses `db teardown` no matter how many flags you pass.
- Vault and identity operations that need a private key still need the key — either on disk at `~/.noorm/identity.key` or in `$NOORM_IDENTITY_PRIVATE_KEY`.

If a command refuses with a useful error in interactive mode, it refuses
with the same error in `--yes` mode. The flag turns prompts off, not
preconditions off.
