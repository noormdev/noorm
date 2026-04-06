---
"@noormdev/cli": patch
---

### Fixed

* `fix(teardown):` Sort composite types (TVPs) before domain types during teardown to prevent dependency failures on MSSQL, which lacks `DROP TYPE ... CASCADE`
