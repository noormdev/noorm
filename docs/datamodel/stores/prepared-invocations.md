---
kind: cache
title: Prepared Invocations
description: Ephemeral preflighted non-dry-run invocation context awaiting execution.
---

Preparation holds the selected manifest and caller context together after preflight and before execution. This in-memory handoff is ephemeral, not a database table or a resume checkpoint. It contains `slug`, `config_name`, `executed_by`, `transaction_policy`, `manifest_checksum`, ordered `steps` (`step_no`, `name`, `path`, `sql_checksum`, and prepared SQL), and `dry_run: false`. Prepared SQL is execution-only and must not appear in normal caller results or history. A dry run does not enter this execution handoff. Samples are synthetic; checksums are abbreviated to eight characters and SQL text is schematic.

## Sample values

| slug | config_name | executed_by | transaction_policy | manifest_checksum | steps | dry_run |
| --- | --- | --- | --- | --- | --- | --- |
| refresh-reporting | dev | synthetic-operator | pipeline | `cccccccc` | `[{step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb, sql: "SELECT 1"}, {step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb, sql: "SELECT 2"}, {step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb, sql: "SELECT 3"}]` | false |
| refresh-reporting | dev | synthetic-operator | step | `eeeeeeee` | `[{step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb, sql: "SELECT 1"}, {step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb, sql: "SELECT 2"}, {step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb, sql: "SELECT 3"}]` | false |
