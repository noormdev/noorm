---
"@noormdev/cli": minor
---

## Added

* `feat(cli):` Migrate CLI from meow to citty with structured subcommands, built-in `--help` examples, and `noorm ui` launcher
* `feat(cli):` Add shell completion via `@bomb.sh/tab`

## Fixed

* `fix(change):` Populate `cli_version` in change history rows
* `fix(cli):` Suppress `logger.info` inside `fn()` callbacks when `--json` is active
* `fix(cli):` Restore vault cp dry-run preview and 3-positional CLI surface
* `fix(cli):` Wire JSON output for change run/revert and unify history JSON path
* `fix(cli):` Restore human-readable db transfer output
