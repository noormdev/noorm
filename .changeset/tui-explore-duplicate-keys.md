---
'@noormdev/cli': patch
'@noormdev/sdk': patch
---

Stop TUI lists from leaving stale rows on screen when two rows share an identity: explore indexes and foreign keys whose names repeat across tables (SQL Server's `IX_UserId`, MySQL's `PRIMARY`), PostgreSQL function and procedure overloads, and settings rules with the same description. `listFunctions` and `listProcedures` now return a `signature` on PostgreSQL that tells overloads apart.
