---
"@noormdev/cli": patch
---

## Fixed
* `fix(mssql):` Resolve SQL Server build failures caused by Kysely emitting unsupported `LIMIT` and `RETURNING` syntax
* `fix(mssql):` Add MssqlLimitPlugin to translate `.limit()` to `TOP` for all MSSQL queries
* `fix(mssql):` Use `OUTPUT inserted.id` instead of `RETURNING` for insert-and-get-id operations
* `fix(mssql):` Pass dialect from connection through all run screens to runner context
* `fix(schema):` Make v2 migration fully idempotent — handles partial migration states, orphaned tables, and interrupted runs
* `fix(schema):` Handle interrupted v1 migrations where tables exist but version record is missing
* `fix(schema):` Run `ensureSchemaVersion` before identity sync to prevent queries against unmigrated tables
* `fix(schema):` Move `waitForIdentityToLoad` out of connection factory into schema migration lifecycle
* `fix(logger):` Preserve Error objects in log redaction filter instead of spreading into empty `{}`
* `fix(logger):` Surface `.cause` chain in error log messages for wrapped errors
* `fix(runner):` Handle non-standard error objects from tedious driver including `AggregateError`
* `fix(runner):` Propagate batch-level errors to TUI when build fails before file execution
* `fix(runner):` Truncate `skip_reason` to prevent column overflow on MSSQL
* `fix(tui):` Show relative file paths in failed files list instead of basename only
