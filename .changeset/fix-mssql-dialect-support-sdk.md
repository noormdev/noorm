---
"@noormdev/sdk": patch
---

## Fixed
* `fix(mssql):` Resolve SQL Server failures in runner and change tracking operations
* `fix(mssql):` Add `OUTPUT inserted.id` support for MSSQL insert operations
* `fix(mssql):` Translate `.limit()` to `TOP` via MssqlLimitPlugin
* `fix(schema):` Make v2 migration fully idempotent with partial-state recovery
* `fix(runner):` Handle `AggregateError` and non-standard error objects from tedious driver
