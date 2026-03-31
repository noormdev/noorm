---
"@noormdev/cli": patch
---

### Fixed

* `fix(teardown):` Schema-qualify all DROP statements in teardown to prevent failures when the connection user's default schema differs from `dbo` (MSSQL) or `public` (PostgreSQL)
