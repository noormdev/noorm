---
"@noormdev/cli": patch
---

## Fixed
* `fix(cli):` Surface SQL errors and skip reasons in `run` and `change` output
* `fix(cli):` `noorm run build` / `dir` / `files` / `exec` now print each failed file's driver error inline and route the summary through `logger.error` on non-success
* `fix(cli):` `noorm run file` and the skip path now report `(skipped: <reason>)` so callers know whether the file was unchanged or already-run
* `fix(cli):` `noorm change ff` / `run` / `revert` / `rewind` print per-change error detail on failure instead of just `(failed)`
