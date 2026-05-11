# Discovering command help


Every `noorm` command exposes its own help via the standard `--help`
(or `-h`) flag. There is no `noorm help <subcommand>` form — `noorm`'s
CLI framework (citty) renders help natively per command, and that's the
canonical surface.


## Canonical form

Append `--help` (or the short `-h`) to any command — including
multi-segment commands like `db create` or `change ff`:

    noorm --help
    noorm db --help
    noorm db create --help
    noorm change ff --help
    noorm sql query --help

The help output includes the usage line, every flag with its
description, and a curated `EXAMPLES` block where the command author
added one.


## Why not `noorm help <sub>`?

citty (the CLI framework `noorm` is built on) doesn't ship a
re-dispatching `help` subcommand. Adding one would mean a parallel
copy of every command's help text — easy to let drift. The `--help`
flag is uniform, always current, and matches the convention used by
`git`, `kubectl`, `docker`, and most other modern CLIs.

If you arrive from a tool like `npm`, `yarn`, or older `commander`-based
CLIs that DO support `npm help <sub>`, just swap to the flag form:

    # this errors with "Unknown command help"
    noorm help db create

    # this is the equivalent that works
    noorm db create --help


## Related

- [Flag conventions](./flags.md) — where `--help` and other flags must
  be placed relative to the subcommand.
