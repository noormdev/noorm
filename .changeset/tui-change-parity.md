---
"@noormdev/cli": patch
---

## Fixed
* `fix(tui):` change operations now receive the active config's dialect — on sqlite and mysql the TUI queried postgres-shaped tracking tables, and the failed read surfaced as a successful no-op
* `fix(tui):` the global dry-run and force toggles are now honoured by `ff`, `next`, `run`, `revert`, and `rewind` — dry-run was displayed as active while changes applied for real
* `fix(tui):` core errors are surfaced as a toast instead of being written only to the log file
