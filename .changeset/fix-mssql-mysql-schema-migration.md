---
"@noormdev/cli": patch
---

## Schema

### Fixed
* `fix(schema):` MSSQL schema migration fails with `auto_increment` syntax error — use `identity(1,1)` instead
* `fix(schema):` MSSQL schema migration fails when multiple `timestamp` columns exist — use `datetime2` for MSSQL
* `fix(schema):` MySQL schema migration fails on `TEXT` columns with default values — use `varchar(2000)` for error messages
* `fix(schema):` MySQL and MSSQL `DROP INDEX` requires `ON table_name` — made `down()` dialect-aware
