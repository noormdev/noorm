---
"@noormdev/sdk": minor
---

### Added

* `feat(sdk):` Add TVP (table-valued parameter) support for MSSQL via `tvp()` helper — pass structured tabular data to `ctx.proc()`, `ctx.func()`, and `ctx.tvf()` calls
* `feat(sdk):` Validate TVP row key consistency and enforce MSSQL's 2,100 parameter limit with clear error messages
