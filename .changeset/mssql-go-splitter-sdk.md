---
"@noormdev/sdk": minor
---

## Added
* `feat(runner):` Split MSSQL SQL files on the `GO` batch separator. Multi-statement DDL files (multiple `CREATE PROCEDURE` / `CREATE FUNCTION` / `CREATE TRIGGER` / `CREATE VIEW` / `CREATE TYPE` in one file) now run correctly instead of failing with `Incorrect syntax near 'GO'`.
* `feat(runner):` Batch failures report the failed batch index in `FileResult.error` (e.g. `[batch 3 of 5] <driver error>`) and short-circuit the remaining batches.

## Known limitations
* `GO` inside string literals or block comments is still treated as a separator — matches `sqlcmd` behavior. Document accordingly when authoring T-SQL files.
* `GO <N>` repetition is not implemented.
