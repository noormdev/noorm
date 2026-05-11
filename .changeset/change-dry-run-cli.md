---
"@noormdev/cli": patch
---

## Fixed
* `fix(cli):` Wire `noorm change ff --dry-run` (and `next` / `run` / `revert`) through to the SDK — the flag previously parsed but did nothing
* `fix(cli):` Drop the unreachable positional `query` arg from `noorm sql` and add an argv rewriter so `noorm sql "SELECT 1"` is rewritten to `noorm sql query "SELECT 1"` before citty dispatch
* `fix(cli):` Show `(dry-run)` markers in human output and `dryRun: true` in `--json` envelopes for all four change commands
