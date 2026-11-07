---
entity: change
group: existing
description: "Operation batches for builds, runs, and changes."
pk: [id]
columns:
  id: { type: "serial / int identity(1,1) / integer auto-increment", desc: "Generated primary key (PostgreSQL / MSSQL / MySQL and SQLite)." }
  name: { type: "varchar(255)", desc: "Operation identifier." }
  change_type: { type: "varchar(50)", desc: "Current application values build, run, change; pipeline is proposed only." }
  direction: { type: "varchar(50)", desc: "Application direction: change or revert." }
  checksum: { type: "varchar(64)", default: "", desc: "SHA-256 of sorted file checksums." }
  executed_at: { type: "timestamp / datetime2", default: CURRENT_TIMESTAMP, desc: "Execution timestamp." }
  executed_by: { type: "varchar(255)", default: "", desc: "Executing identity string." }
  config_name: { type: "varchar(255)", default: "", desc: "Configuration name." }
  cli_version: { type: "varchar(50)", default: "", desc: "CLI version." }
  status: { type: "varchar(50)", desc: "Application status: pending, success, failed, reverted, or stale." }
  error_message: { type: "varchar(2000)", default: "", desc: "Error details, or empty when absent." }
  duration_ms: { type: integer, default: 0, desc: "Elapsed milliseconds; zero when never run." }
examples:
  - { id: 1036, name: "seed-pending", change_type: change, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-01T09:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: pending, error_message: "", duration_ms: 0 }
  - { id: 1037, name: "retire-view", change_type: change, direction: revert, checksum: "aaaaaaaa", executed_at: '2026-01-01T09:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: reverted, error_message: "", duration_ms: 1200 }
  - { id: 1038, name: "obsolete-view", change_type: change, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-01T09:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: stale, error_message: "", duration_ms: 800 }
  - { id: 1039, name: "ad-hoc-report", change_type: run, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-01T09:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: failed, error_message: "SQL execution failed", duration_ms: 2000 }
  - { id: 1040, name: "build", change_type: build, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-01T09:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: success, error_message: "", duration_ms: 3000 }
  - { id: 1041, name: "build-incremental", change_type: build, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-01T09:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: success, error_message: "", duration_ms: 1000 }
  - { id: 1042, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-10T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: failed, error_message: "Pipeline did not complete successfully", duration_ms: 120000 }
  - { id: 1043, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-11T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: failed, error_message: "Pipeline did not complete successfully", duration_ms: 120000 }
  - { id: 1044, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-12T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: success, error_message: "", duration_ms: 180000 }
  - { id: 1045, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-13T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: failed, error_message: "Pipeline did not complete successfully", duration_ms: 60000 }
  - { id: 1046, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-14T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: success, error_message: "", duration_ms: 180000 }
  - { id: 1047, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-15T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: failed, error_message: "Pipeline did not complete successfully", duration_ms: 60000 }
  - { id: 1048, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-16T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: success, error_message: "", duration_ms: 180000 }
  - { id: 1049, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-17T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: failed, error_message: "Pipeline did not complete successfully", duration_ms: 60000 }
  - { id: 1050, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-18T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: failed, error_message: "Pipeline did not complete successfully", duration_ms: 120000 }
  - { id: 1051, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-19T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: pending, error_message: "", duration_ms: 0 }
  - { id: 1052, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-20T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: pending, error_message: "", duration_ms: 120000 }
  - { id: 1053, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-21T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: failed, error_message: "Pipeline did not complete successfully", duration_ms: 120000 }
  - { id: 1054, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-22T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: failed, error_message: "Transaction outcome unknown", duration_ms: 180000 }
  - { id: 1055, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-23T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: pending, error_message: "", duration_ms: 180000 }
  - { id: 1056, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-24T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: success, error_message: "", duration_ms: 180000 }
  - { id: 1057, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-25T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: failed, error_message: "Transaction outcome unknown", duration_ms: 120000 }
  - { id: 1058, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-26T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: success, error_message: "", duration_ms: 180000 }
  - { id: 1059, name: refresh-reporting, change_type: pipeline, direction: change, checksum: "aaaaaaaa", executed_at: '2026-01-27T10:00:00Z', executed_by: "synthetic-operator", config_name: dev, cli_version: "1.0.0", status: failed, error_message: "Pipeline did not complete successfully", duration_ms: 60000 }
---

# change

Records operation batches, including builds, ad-hoc runs and changes, with their outcome and execution context. Each [[executions|file execution]] belongs to one operation. All examples are synthetic snapshots; pipeline rows illustrate a proposal rather than current behavior.

## Rules and source

All columns are non-null; generated IDs and timestamp types are dialect-specific as in `src/core/version/schema/migrations/v1.ts`. Timestamps are naive and interpreted as UTC. The application types in `src/core/shared/tables.ts` specify `build | run | change`, direction `change | revert`, and the five statuses above; the migration defines varchar columns, not database check constraints. `executed_by` and `config_name` are strings, not foreign keys. The name/config index is not unique.

## Proposal

A proposed pipeline discriminator extends the current application values with `pipeline` to identify invocations represented by [[pipeline_run]] and their [[pipeline_step|steps]]. This is a proposed change, not a current subtype or existing database constraint. The generic status is a coarse projection: pending and running map to `pending`, confirmed success to `success`, and partial, interrupted, failed, or unknown to `failed`. The pipeline tables, not this projection, carry the authoritative outcome. IDs 1036–1041 illustrate existing nonpipeline operations; IDs 1042–1059 are linked proposed pipeline snapshots.
