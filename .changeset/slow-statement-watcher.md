---
'@noormdev/cli': minor
'@noormdev/sdk': minor
---

Show what a long-running SQL file is doing. After 10 seconds the runner asks the server about the file's session every 10 seconds, from a second pooled connection, and emits `file:progress`: elapsed time, the command's own progress (PostgreSQL `pg_stat_progress_*`, SQL Server `percent_complete`, MySQL stage counters), and the sessions it is waiting on. The TUI run and change screens render it under the running file, and the log records it. Build and exec runs in the TUI cancel on a second `Escape` within 2 seconds; PostgreSQL and MySQL stop the running statement on the server.
