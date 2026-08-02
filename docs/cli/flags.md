# CLI flag conventions


`noorm`'s CLI is built on [citty](https://github.com/unjs/citty), which parses flags
relative to the subcommand they belong to — a flag typed before the subcommand name never
reaches the leaf command's own parser. `noorm` works around that for the one flag that
genuinely needs to run before dispatch, by stripping it out of `argv` before citty ever sees
it. This page covers that flag and the rule for everything else.


## Global flags vs per-subcommand flags

A flag is **global** when `noorm` recognizes and hoists it regardless of where it appears —
before or after the subcommand. A flag is **per-subcommand** when it's owned by an
individual command like `noorm sql query` and only works *after* the subcommand name.

`noorm` hoists exactly one flag on purpose — most flags vary in meaning per command (`-c` is
`--cwd` at the root, but `--config` on many subcommands), so per-subcommand parsing is the
default for everything else, `--dry-run`/`--json`/`--yes` included.


### The one global: `-c` / `--cwd <path>`

| Flag | Purpose |
|------|---------|
| `--cwd <path>` / `-c <path>` | Change working directory before resolving `.noorm/`. Same idea as `git -C`. Recognized only **before** the subcommand — see the note below. |

`--cwd`/`-c` is global for two reasons:

1. It's consumed **before dispatch** — it sets the working directory everything else
   (project discovery, config resolution) resolves against, so it's genuinely the CLI's own
   flag rather than any subcommand's.
2. `-c` already means `--config` *after* the subcommand (see the overload note below).
   Hoisting it lets `noorm -c <path> run build` mean cwd while `noorm run build -c <name>`
   means config, without either shadowing the other.

Examples:

    noorm -c packages/db run build
    noorm --cwd /repos/myapp change ff

`--help`/`-h` and `--version`/`-v` are also recognized outside this mechanism — that's citty's
own framework behaviour, not a `noorm`-specific hoist.

An unrecognized flag placed before the subcommand is an error, not a silent no-op:

    $ noorm --bogus-flag config list
    Error: Unrecognized flag '--bogus-flag' before the subcommand — noorm can't forward it there.
    The only root-level flag is -c/--cwd <path>; every other flag goes on the command that uses it.
    Move '--bogus-flag' after the subcommand instead, e.g. noorm <command> ... --bogus-flag.


### Per-subcommand flags (after the subcommand)

Everything else lives on a specific subcommand — `--config <name>`, `--force`, `--dry-run`,
`--json`, `--yes`/`-y`, and any command-specific flag. These are **not** hoisted, so they only
work after the subcommand name:

    noorm run build --dry-run
    noorm config list --json
    noorm secret rm OLD_KEY --yes

Placed before the subcommand instead, none of them are honoured — `noorm --dry-run run build`
is rejected exactly like `noorm --bogus-flag config list` above, naming `--dry-run` as the
offending flag. To see exactly which flags a command accepts, append `--help` to it:

    noorm change ff --help
    noorm db create --help
    noorm sql query --help


## The `--config` / `-c` overload

`-c` is overloaded by position, which is the one sharp edge left in this system:

- `noorm -c <path> run build` — global `--cwd`, because `-c` appears **before** the subcommand.
- `noorm run build -c <name>` — per-command `--config`, because `-c` appears **after** the subcommand.

The first non-flag token (the subcommand name) is the boundary that decides which meaning
applies. `--config` in long form has no global meaning at all — it only works after the
subcommand, so `noorm --config prod run build` is not the same as `noorm run build --config prod`
(the former is rejected as an unrecognized global flag).


## Mental model

`noorm` has exactly one true global, `-c`/`--cwd`, and everything else is command-scoped. Put
every flag right next to the subcommand it modifies:

    noorm <subcommand> <flags…> <positional args…>

If a flag isn't being honored, it's placed before the subcommand boundary — or it's a typo,
in which case `noorm` now says so instead of silently dropping it.


## Related

- [`noorm` help conventions](./help.md) — how to find a command's flags.
- [Headless reference](../headless.md) — full table of common flags.
- [Troubleshooting](../guide/troubleshooting.md) — quick fixes for common surprises.
