---
"@noormdev/sdk": patch
---

## Changed
* `feat(sdk):` `changes.ff(options?)` and `changes.next(count, options?)` now accept `BatchChangeOptions` so callers can pass `dryRun` / `force`. Previously the options were silently dropped before reaching the manager.
