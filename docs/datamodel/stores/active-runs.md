---
kind: cache
title: Active Runs
description: Ephemeral run identity and ordered execution context for an invocation in progress.
---

After audit intent is created, this in-memory handoff associates the run ID with the selected configuration, identity, policy, and ordered steps (`step_no`, `name`, `path`, `sql_checksum`, and prepared SQL) for execution. Prepared SQL is execution-only and must not appear in normal caller results or history. It is distinct from persistent [[pipeline_run]] and [[pipeline_step]] audit records: it is neither a new table nor a resume checkpoint and disappears with the process. Samples show synthetic in-flight context, not final historical snapshots; SQL text is schematic and checksums are abbreviated to eight characters.

## Sample values

| run_id | slug | config_name | executed_by | transaction_policy | steps |
| --- | --- | --- | --- | --- | --- |
| 1042 | refresh-reporting | dev | synthetic-operator | pipeline | `[{step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb, sql: "SELECT 1"}, {step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb, sql: "SELECT 2"}, {step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb, sql: "SELECT 3"}]` |
| 1043 | refresh-reporting | dev | synthetic-operator | step | `[{step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb, sql: "SELECT 1"}, {step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb, sql: "SELECT 2"}, {step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb, sql: "SELECT 3"}]` |
