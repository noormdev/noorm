---
'@noormdev/cli': minor
'@noormdev/sdk': minor
---

Add SQL pipelines for named workflows with typed inputs, dependency-aware execution, transaction boundaries, and independent config-scoped history through the CLI and SDK. Add native terminal screens for definition review, explicit typed input overrides, protected run and dry-run confirmation, settled execution and transaction evidence, and bounded history or run-ID lookup without a local definition. Pipeline stop and managed shutdown wait for active work and bookkeeping without promising server-side cancellation; cleanup warnings preserve recorded outcomes and nonzero shutdown status.

Pipelines move the tracking schema to version 3, which adds the pipeline run and step tables. The move is one way. An older CLI or TUI that connects to a version 3 database fails with `VersionMismatchError`, so upgrade them before the first connect. An older SDK keeps working and ignores the pipeline tables, except that `vault.copy` to a version 3 destination throws `VersionMismatchError`. A pipeline run checks that a step did not end the managed transaction, which needs PostgreSQL 13 or later and SQL Server 2016 or later.

The TUI shutdown screen now marks phases that timed out and says that a second `Ctrl+C` forces exit. A timed-out phase, a failed cleanup, or a forced exit leaves the process with a nonzero exit code. Shutdown no longer replaces an exit code already set with `0`.
