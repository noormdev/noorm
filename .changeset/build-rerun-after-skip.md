---
"@noormdev/cli": patch
"@noormdev/sdk": patch
---

## Fixed
* `fix(runner):` a third consecutive `run build` no longer re-executes a file the previous build correctly skipped — `skipped` was treated as "never ran" regardless of why, so an `unchanged` skip forced a re-run and failed on any DDL that is not idempotent
