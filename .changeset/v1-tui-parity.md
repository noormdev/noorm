---
"@noormdev/cli": minor
---

## TUI matches the CLI on gating and global modes

### Fixed

* `fix(tui):` `db transfer` routes through the gated path with a typed confirmation. It called core directly, skipping the confirmation tier the SDK enforces.
* `fix(tui):` the global dry-run toggle is honoured by transfer, truncate and teardown. The indicator showed dry-run as active while all three ran for real.
* `fix(tui):` `truncateFirst` is a working control instead of state the UI could display but never change.
* `fix(tui):` `vault propagate` is no longer a bare `p` keypress — it checks policy and names each recipient before granting access to every enrolled identity.
* `fix(tui):` fixed 15 stale-closure dependency omissions across hooks and screens. `react-hooks/exhaustive-deps` is not enabled in this repo, so callbacks silently captured first-render values.
* `fix(tui):` `InitScreen` no longer overwrites an existing `.noorm/.gitignore` on re-init.
