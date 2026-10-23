# Discovering command help


Append `--help` or `-h` to any command to see its usage, flags, and examples.

```
$ noorm run inspect --help
Inspect template context for a .sql.tmpl file (noorm run inspect)

USAGE noorm run inspect [OPTIONS] <PATH>

ARGUMENTS

  PATH    Path to the .sql.tmpl file (Required)

OPTIONS

  -c, --config=<config>    Use specific configuration
                 --json    Output JSON               


EXAMPLES

  noorm run inspect db/sql/users/001_create.sql.tmpl
  noorm run inspect db/sql/core/05_Cron/Crons.sql.tmpl --json
```

The same flag works at every depth: `noorm --help`, `noorm db --help`, `noorm db create --help`, `noorm change ff --help`. A parent command lists its subcommands. A leaf command lists its flags and an `EXAMPLES` block when its author wrote one.


## What if I type `noorm help <command>`?


noorm has no `help` subcommand. citty renders help per command, so one source serves every command and no second copy can drift.

| Input | Result |
|-------|--------|
| `noorm <command> --help`, `-h` | Usage, flags, examples; exit 0 |
| `noorm --help` | Command list; exit 0 |
| `noorm` | Command list, then `No command specified.`; exit 1 |
| `noorm help db create` | Command list, then `Unknown command help`; exit 1 |
| `noorm --version`, `noorm -v` | Version only, when it is the sole argument |

For shell completion, run `noorm complete <shell>` and source the script it prints. [Flag placement](/cli/flags) explains where `--help` and the other flags may go.


## Next


- [CLI flag conventions](/cli/flags)
- [CLI reference](/headless)
