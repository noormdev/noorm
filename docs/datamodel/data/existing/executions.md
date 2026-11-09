---
entity: executions
group: existing
description: "Individual file execution results within operation batches."
pk: [id]
columns:
  id: { type: "serial / int identity(1,1) / integer auto-increment", desc: "Generated primary key (PostgreSQL / MSSQL / MySQL and SQLite)." }
  change_id: { type: integer, desc: "Required parent operation ID." }
  filepath: { type: "varchar(500)", desc: "Executed file path." }
  file_type: { type: "varchar(10)", desc: "Application file type: sql or txt." }
  checksum: { type: "varchar(64)", default: "", desc: "SHA-256 of file contents." }
  cli_version: { type: "varchar(50)", default: "", desc: "CLI version." }
  status: { type: "varchar(50)", desc: "Application status: pending, success, failed, or skipped." }
  error_message: { type: "varchar(2000)", default: "", desc: "Error details or empty string." }
  skip_reason: { type: "varchar(100)", default: "", desc: "Reason a file was skipped, or empty string." }
  duration_ms: { type: integer, default: 0, desc: "Elapsed milliseconds; zero when never run." }
relationships:
  - target: change
    on: { change_id: id }
    predicate: { fwd: records, rev: belongs to }
examples:
  - { id: 8101, change_id: 1036, filepath: "changes/seed.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: pending, error_message: "", skip_reason: "", duration_ms: 0 }
  - { id: 8102, change_id: 1037, filepath: "changes/retire.revert.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 1200 }
  - { id: 8103, change_id: 1038, filepath: "changes/obsolete.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 800 }
  - { id: 8104, change_id: 1039, filepath: "reports/broken.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: failed, error_message: "SQL execution failed", skip_reason: "", duration_ms: 2000 }
  - { id: 8105, change_id: 1039, filepath: "reports/after.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior file failed", duration_ms: 0 }
  - { id: 8106, change_id: 1040, filepath: "build/manifest.txt", file_type: txt, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 1000 }
  - { id: 8107, change_id: 1040, filepath: "build/schema.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 2000 }
  - { id: 8108, change_id: 1041, filepath: "build/schema.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "unchanged", duration_ms: 0 }
---

# executions

Records individual files executed as part of a [[change|change operation]]. These synthetic examples are independent snapshots, not event histories or production records.

## Rules and source

Every column is non-null. The required `change_id` foreign key references `change.id` with `ON DELETE CASCADE`; the migration also creates a non-unique index on it. The application types in `src/core/shared/tables.ts` define file types and statuses; the migration uses varchar columns without checks. In the examples, skipped execution 8105 was unreached after a failure, while 8108 was unchanged; the txt row 8106 is a manifest. Source: `src/core/version/schema/migrations/v1.ts` and `v2.ts`.
