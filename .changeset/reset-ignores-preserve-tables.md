---
"@noormdev/sdk": patch
---

fix(sdk): db.reset() no longer preserves tables before rebuilding

`db.reset()` (teardown + build) honored `settings.teardown.preserveTables`,
so any preserved table (e.g. reference vocabulary kept for the per-test
`truncate()` workflow) survived the teardown and then collided with the
build's `CREATE TABLE`, aborting the rebuild and leaving a partial schema.
reset() now performs a full teardown that ignores `preserveTables` — a full
rebuild starts from nothing. `preserveTables` still applies to standalone
`teardown()` and `truncate()`.
