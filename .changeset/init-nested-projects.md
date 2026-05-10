---
"@noormdev/cli": minor
---

### Added
* `feat(cli):` Add `noorm init --here` to initialize a project in the original cwd, ignoring any parent `.noorm/` discovered while walking up
* `feat(cli):` Add global `-c <path>` / `--cwd <path>` flag (like `git -C`) that runs the subcommand inside `<path>` and skips the walk-up. Must precede the subcommand; after the subcommand `-c` keeps its per-command `--config` meaning.

### Changed
* `refactor(cli):` `noorm init` now reports an existing `.noorm/` *before* the TTY gate, so scripted invocations get the more actionable error.
