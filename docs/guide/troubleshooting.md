# Troubleshooting common surprises


A short list of the issues users hit most often when first reaching
for `noorm`. Each entry is a search target plus a one-paragraph fix
and a link to the deeper doc.


## `noorm --config prod run build` fails or targets the wrong directory

`--config` (long form) is per-subcommand only — it has no global meaning. Neither do
`--dry-run`, `--json`, or `--yes`: the only flag with a root-level meaning is `-c`/`--cwd`.
Placed before the subcommand, `--config` (and everything else) is rejected outright rather
than silently ignored:

    # rejected: --config has no global form
    noorm --config prod run build

    # works
    noorm run build --config prod
    noorm run build -c prod

`-c` is the sharper trap: `noorm -c prod run build` is *not* the same command — before the
subcommand, `-c` means `--cwd`, not `--config`. See [CLI flag conventions](../cli/flags.md)
for the full rule.


## `noorm help db create` errors with "Unknown command help"

There is no `noorm help <subcommand>` form — `noorm`'s CLI framework
(citty) doesn't ship one. Use `--help` (or `-h`) instead:

    noorm db create --help
    noorm change ff --help
    noorm sql query --help

See [Discovering command help](../cli/help.md).


## `noorm db create --name foo` doesn't work

`noorm db create` has no `--name` flag. The database name lives in the
stored config; create the config first, then point `db create` at it.
The intended workflow is:

    noorm config import dev-config.json
    noorm db create -c dev
    noorm config use dev

See [Creating a database](./database/create.md) for the reasoning and
the full CI bootstrap.


## My MSSQL proc's `DEFAULT` value isn't applied

A Zod schema with `.optional()` parses missing keys to `undefined`.
The SDK serializes `undefined` (and `null`) to SQL `NULL` when
building a named-parameter `EXEC`. MSSQL applies a parameter's
`DEFAULT` only when the parameter is *omitted* from the call, not when
it's explicitly `NULL`. Two fixes:

1. Use `.default(<value>)` in your Zod schema so the parsed input
   always carries a concrete value.
2. Or, build the params object without the key entirely (e.g.
   conditionally `delete obj.key` before calling `ctx.proc(...)`).
   The SDK only emits `@key = …` for keys present in the object.

See [SDK reference — Parameter handling and NULL semantics](../reference/sdk.md#parameter-handling-and-null-semantics).


## `noorm sql "SELECT ..."` errors with "Unknown command"

The bare `noorm sql "<SQL>"` form is supported, but only when the
first token of the query is one of citty's recognized SQL keywords
(`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `WITH`, etc.). For anything
that starts with a leading comment, a CTE-style preamble, or a
non-recognized verb, use the explicit subcommand:

    noorm sql query "<your SQL>"
    noorm sql query -f path/to/file.sql

See [`noorm sql`](../cli/sql.md) for the full list of recognized
keywords and when each form fires.


## `noorm change ff --dry-run` still commits

Some commands accept `--dry-run` and some don't — `change ff` is one
of the ones that doesn't (as of this writing). When you need a
preview, use the SDK's `changes.apply(name, { dryRun: true })` or
inspect rendered SQL via `noorm run preview <path>`.


## `noorm init` errors in CI with "requires an interactive terminal"

The bootstrap path needs an existing identity at
`~/.noorm/identity.{key,pub,json}`, then `--yes` (or `NOORM_YES=1`)
skips every other prompt. Two commands:

    noorm identity init --name "$CI_USER" --email "$CI_EMAIL"
    noorm init --yes

See [Non-interactive operation](./automation/non-interactive.md).


## Related

- [CLI flag conventions](../cli/flags.md)
- [Discovering command help](../cli/help.md)
- [Creating a database](./database/create.md)
- [Non-interactive operation](./automation/non-interactive.md)
- [SDK reference](../reference/sdk.md)
