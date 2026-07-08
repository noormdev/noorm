# Creating a database


`noorm db create` provisions the database named in a stored config. It
has no `--name`, `--dialect`, or `--host` flag — by design.

The reasoning is short: a noorm config is the single source of truth
for *which* database, *where*, *as whom*, and *with what guardrails*.
Inline flags would duplicate that record and create two ways to
describe the same target. The CLI sidesteps that by requiring you to
declare the config first, then create against it.

This page covers the intended order of operations and the cross-tool
discovery hints that get users back on track when their muscle memory
expects a `--name` flag.


## The configs-first workflow

End-to-end, from a clean repo to a usable database:

    # 1. Scaffold the project (settings.yml, .noorm/, sql/, changes/).
    noorm init --yes

    # 2. Add one config per environment, non-interactively.
    noorm config import dev-config.json
    noorm config import test-config.json

    # 3. Create the underlying database for each config.
    noorm db create -c dev
    noorm db create -c test

    # 4. Pick the active config for ad-hoc commands.
    noorm config use dev

After step 4, every `noorm` command that doesn't pass `-c <name>`
inherits the active config. `noorm run build`, `noorm change ff`, and
`noorm sql query "…"` all target the `dev` database until you switch.


## What `noorm db create` does (and what it needs)

The command connects to the dialect's *system database*
(`postgres` for PostgreSQL, `master` for MSSQL; MySQL skips this) with
the credentials in the named config, then runs the dialect's
`CREATE DATABASE` statement targeted at `config.connection.database`.

It needs:

- An active config (or an explicit `-c <name>`).
- Credentials in the config that can reach the server.
- A server-level permission to create databases (e.g. `CREATEDB` on
  PostgreSQL, `dbcreator` role on MSSQL).

It does not need:

- The target database to already exist — that's the whole point.
- A `.noorm/` schema to be built — `noorm run build` is a separate
  step.


## Why no `--name <database>` flag?

Three reasons, in order of importance:

1. **Configs already hold the database name.** The connection block
   in a noorm config carries `dialect`, `host`, `port`, `database`,
   `user`, `password`, and a handful of safety flags (`isTest`,
   `access`). Passing `--name foo` would let you bypass the config's
   `access` role and create a database the active config doesn't
   know about — a foot-gun.

2. **The config is also where stage defaults, secrets, and identity
   bindings live.** A flag-only path would need its own copy of every
   one of those, or it would inherit silently from the active config
   and surprise the user.

3. **It pushes you to write the config down.** `noorm config import`
   is non-interactive and idempotent; the JSON file becomes the
   reviewable artifact in your repo or CI runner.

If you genuinely need ad-hoc database creation without a stored
config, fall back to a one-shot SQL statement against the system
database:

    noorm sql query -c dev "CREATE DATABASE foo"

That's an explicit, dialect-aware path — and it forces you to pick
a config (and therefore a connection identity) for the operation.


## Companion commands

| Command | Purpose |
|---------|---------|
| `noorm config import <path>` | Add a config from a JSON file (non-interactive). |
| `noorm config list` | See which configs exist and which is active. |
| `noorm config use <name>` | Switch the active config. |
| `noorm db create [-c <name>]` | Create the database described by the named config. |
| `noorm db drop [-c <name>]` | Drop the database described by the named config. |

For interactive setup (when you're at a terminal), `noorm ui` launches
a wizard that walks through identity → config → DB create in order.
Scripted setups should stick with the `import` + `create` flow above.


## CI / non-interactive bootstrap

The same flow inside a CI runner — every step has a non-interactive
path:

    #!/usr/bin/env bash
    set -euo pipefail

    # 1. Identity (once per runner).
    noorm identity init --name "$CI_USER" --email "$CI_EMAIL"

    # 2. Project scaffold.
    noorm init --yes

    # 3. Configs from version-controlled JSON.
    noorm config import ./ci/dev.config.json
    noorm config import ./ci/test.config.json

    # 4. Databases.
    noorm db create -c dev
    noorm db create -c test

    # 5. Schema + changes.
    noorm config use dev
    noorm run build
    noorm change ff

See [Non-interactive operation](../automation/non-interactive.md) for
the full matrix of `--yes` / `NOORM_YES` behavior.


## Related

- [`noorm init`](../../cli/init.md) — project scaffold and identity bootstrap.
- [Non-interactive operation](../automation/non-interactive.md) — `--yes` opt-in and CI flow.
- [Troubleshooting](../troubleshooting.md) — what to do when `noorm db create --name foo` doesn't behave as expected.
