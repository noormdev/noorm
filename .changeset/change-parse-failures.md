---
'@noormdev/cli': patch
'@noormdev/sdk': patch
---

`noorm change ff` and `change next` now fail at the position of a change folder that cannot be parsed when they would run it (never run, `reverted`, or `stale`), for example a `.txt` manifest that names a file no longer in `sql/`. Before, the folder was skipped, later changes ran without it, and the command exited 0. `change list` shows such a change as `failed` with the parse error, the TUI change screens and home count include it, `changes.pending()` returns it, and `change run <name>` reports the parse error instead of "Change not found". An applied change keeps its status, and the batch adds a warning instead of failing. A folder with neither `change/` nor `revert/` is not a change and is ignored.
