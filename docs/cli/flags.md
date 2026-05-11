# CLI flag conventions


`noorm`'s CLI is built on [citty](https://github.com/unjs/citty), which
parses flags relative to the subcommand they belong to. A flag that
"works on every command" still has to be placed where the parser
expects it. This page covers the two rules that catch most users out.


## Global flags vs per-subcommand flags

A flag is **global** when it's owned by the root `noorm` command and
must appear *before* the subcommand. A flag is **per-subcommand** when
it's owned by an individual command like `noorm sql query` and must
appear *after* the subcommand name.

`noorm` has very few true globals on purpose — most flags vary in
meaning per command (`-c` is `--cwd` at the root, but `--config` on
many subcommands), so per-subcommand parsing is the safer default.


### Globals (before the subcommand)

| Flag | Purpose |
|------|---------|
| `--cwd <path>` / `-c <path>` | Change working directory before resolving `.noorm/`. Same idea as `git -C`. |
| `--help` / `-h` | Show top-level help (citty renders it). |
| `--version` | Print the installed noorm version. |

Examples:

    noorm -c packages/db run build
    noorm --cwd /repos/myapp change ff
    noorm --help


### Per-subcommand flags (after the subcommand)

Everything else lives on a specific subcommand. Common per-subcommand
flags include `--json`, `--config <name>`, `--force`, `--yes`,
`--dry-run`, and `--help`. To see exactly which flags a command
accepts, append `--help` to it:

    noorm change ff --help
    noorm db create --help
    noorm sql query --help


## The `--json` flag specifically

`--json` is the single most common discovery snag. It is **not** a
global flag — every subcommand that supports machine-readable output
declares its own `--json`. That means it must appear after the
subcommand name, not before.

Works (correct placement):

    noorm config list --json
    noorm change ff --json
    noorm sql query "SELECT 1" --json
    noorm --config dev change ff --json

Does not work (citty parses `--json` as an unknown root flag, then
fails to find a subcommand):

    noorm --json config list
    noorm --json change ff
    noorm --json sql query "SELECT 1"

The same rule applies to `--config` / `-c` as a per-command flag (the
form that switches the active config for one invocation). Both
placements happen to be valid for `--config` because the root accepts
it via the citty inheritance hook — but for `--json`, only the
post-subcommand form works.


## Mental model

Think of `noorm` as having a single global (`-c`/`--cwd`) for "where
should I run?" and everything else as command-scoped. When in doubt,
put the flag right next to the subcommand it modifies:

    noorm <subcommand> <flags…> <positional args…>

If a flag isn't being honored, the most likely cause is that it
landed on the wrong side of the subcommand boundary.


## Related

- [`noorm` help conventions](./help.md) — how to find a command's flags.
- [Headless reference](../headless.md) — full table of common flags.
- [Troubleshooting](../guide/troubleshooting.md) — quick fixes for the
  `--json` placement issue and other common surprises.
