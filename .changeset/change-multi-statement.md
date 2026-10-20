---
'@noormdev/cli': patch
'@noormdev/sdk': patch
---

A change file with more than one statement now runs every statement on SQLite, and `GO` batch separators in change files are honored on SQL Server, as they already were for `sql/` files. Before, SQLite ran only the first statement of a change file and reported success.
