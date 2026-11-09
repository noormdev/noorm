---
entity: change
group: existing
description: "Operation batches for builds, runs, and changes."
pk: [id]
columns:
  id: { type: "serial / int identity(1,1) / integer auto-increment", desc: "Generated primary key (PostgreSQL / MSSQL / MySQL and SQLite)." }
  name: { type: "varchar(255)", desc: "Operation identifier." }
  change_type: { type: "varchar(50)", desc: "Current application values build, run, change." }
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
---

# change

Records operation batches, including builds, ad-hoc runs and changes, with their outcome and execution context. Each [[executions|file execution]] belongs to one operation. All examples are synthetic snapshots.

## Rules and source

All columns are non-null; generated IDs and timestamp types are dialect-specific as in `src/core/version/schema/migrations/v1.ts`. Timestamps are naive and interpreted as UTC. The application types in `src/core/shared/tables.ts` specify `build | run | change`, direction `change | revert`, and the five statuses above; the migration defines varchar columns, not database check constraints. `executed_by` and `config_name` are strings, not foreign keys. The name/config index is not unique.

