# Prefetch run gate


## Problem

`executeFiles` decides skip-or-run one file at a time. Each file pays a `needsRun` SELECT and an `updateFileExecution` UPDATE, skip or not, so a 500-file build against a remote database spends about 1,000 round trips before any real work. The change executor has the same shape: `needsRunFile` runs a boundary SELECT and a history SELECT per file.


## Concepts

| Term | Meaning |
|------|---------|
| Gate | The pass before any tracking write: hash every file, fetch tracking state once, decide every file in memory. |
| Run set | Files the gate decided must run. Only these get a pending row. |
| Skip set | Files the gate decided are unchanged. They produce a `FileResult` and a `file:skip` event, and no database write. |
| Decision function | A pure function from (latest record, current checksum, force) to `NeedsRunResult`. The per-file lookup and the gate share it. |


## Business rules

1. A skipped file is never recorded. No pending row, no skipped row, no UPDATE.
2. A build or run whose run set is empty writes no operation row.
3. Templates are rendered, then hashed, then decided. The rendered SQL is kept and executed, so each template renders once.
4. The skip rules stay what they are today: force, new, failed, pending, a skip that is not `unchanged`, stale parent, changed checksum, and lookup error all run. Rows already in existing databases (`skipped/unchanged`, `pending`) still decide correctly.
5. Execution stays sequential, in discovery order.
6. A failure cascade still marks the run-set files that were never reached as `skipped`. These rows are run-set files that never executed, not unchanged-skips, and `needsRun` already reads them as must-run.
7. On the change path the operation row is still written when every file skips. It records the change's combined checksum, which the change-level `needsRun` compares against.


## Approach

The prefetch is one SELECT per batch: the newest execution row per filepath for the config, chosen by a `MAX(id) ... GROUP BY filepath` subquery joined back to the executions and change tables. This form runs unchanged on Postgres, MySQL, MSSQL and SQLite, and has no IN list, so it never reaches MSSQL's 2,100-parameter limit. The result includes filepaths outside the batch, and the runner ignores those in memory.

The change path fetches the opposite-direction boundary once per change rather than once per file. It then fetches the newest qualifying row per filepath for that change in one query.

`runFile` goes through `executeFiles` like the other entry points. This removes the legacy insert-per-file path (`executeSingleFile`, `recordExecution`), which recorded skips.


## Rejected approaches

- **`ROW_NUMBER() OVER (PARTITION BY filepath)`.** Needs SQLite 3.25+ and MySQL 8, and the subquery form is equally fast at this scale.
- **`WHERE filepath IN (...)` and reduce in JS.** Returns the whole history and is capped by MSSQL's parameter limit.
- **Raw-hash gate for templates.** A template's output depends on config and secrets, so the raw bytes cannot prove the output is unchanged.
