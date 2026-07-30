---
"@noormdev/cli": patch
"@noormdev/sdk": patch
---

## MySQL works

### Fixed

* `fix(runner):` `run build` executes on MySQL. `createOperation` emitted a `RETURNING` clause MySQL has no support for, so the operation record was never created and **zero SQL files ran** — the command failed before touching a single file.
* `fix(change):` `recordReset` no longer fails silently on MySQL. It swallowed the same error and returned `0`, so `db teardown` recorded nothing and reported no error at all.
* `refactor(shared):` operation-record insertion is one dialect-aware helper. It existed as three independent copies, which is why fixing the runner left the change module broken and the same defect had to be found twice.
