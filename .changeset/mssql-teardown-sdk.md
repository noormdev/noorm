---
"@noormdev/sdk": patch
---

## Fixed
* `fix(teardown):` Reorder schema teardown to drop procedures and functions before tables. MSSQL schema-bound UDFs (`WITH SCHEMABINDING`) previously blocked the table drop with `Cannot DROP TABLE because it is being referenced by object 'fn_X'`. New order: FK constraints → Procedures → Functions → Views → Tables → Types.
* `fix(teardown):` Replace `sp_MSforeachtable` with per-table sequential `ALTER TABLE [name] NOCHECK CONSTRAINT ALL` (and inverse) in MSSQL `db.truncate()`. The previous implementation spawned parallel workers that deadlocked on schema locks against non-trivial schemas.
* `fix(teardown):` `TeardownDialectOperations.disableForeignKeyChecks` / `enableForeignKeyChecks` now accept an optional `tables?: string[]` and may return `string | string[]`. PostgreSQL / MySQL / SQLite implementations ignore the argument — no behavior change for those dialects.
