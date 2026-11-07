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
  - { id: 8201, change_id: 1042, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8202, change_id: 1042, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: failed, error_message: "Step execution failed", skip_reason: "", duration_ms: 60000 }
  - { id: 8203, change_id: 1042, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
  - { id: 8204, change_id: 1043, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8205, change_id: 1043, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: failed, error_message: "Step execution failed", skip_reason: "", duration_ms: 60000 }
  - { id: 8206, change_id: 1043, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
  - { id: 8207, change_id: 1044, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8208, change_id: 1044, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8209, change_id: 1044, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8210, change_id: 1045, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: failed, error_message: "Step execution failed", skip_reason: "", duration_ms: 60000 }
  - { id: 8211, change_id: 1045, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
  - { id: 8212, change_id: 1045, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
  - { id: 8213, change_id: 1046, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8214, change_id: 1046, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8215, change_id: 1046, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8216, change_id: 1047, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: failed, error_message: "Step execution failed", skip_reason: "", duration_ms: 60000 }
  - { id: 8217, change_id: 1047, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
  - { id: 8218, change_id: 1047, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
  - { id: 8219, change_id: 1048, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8220, change_id: 1048, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8221, change_id: 1048, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8222, change_id: 1049, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: failed, error_message: "Step execution failed", skip_reason: "", duration_ms: 60000 }
  - { id: 8223, change_id: 1049, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
  - { id: 8224, change_id: 1049, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
  - { id: 8225, change_id: 1050, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8226, change_id: 1050, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: failed, error_message: "Step execution failed", skip_reason: "", duration_ms: 60000 }
  - { id: 8227, change_id: 1050, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
  - { id: 8228, change_id: 1051, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: pending, error_message: "", skip_reason: "", duration_ms: 0 }
  - { id: 8229, change_id: 1051, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: pending, error_message: "", skip_reason: "", duration_ms: 0 }
  - { id: 8230, change_id: 1051, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: pending, error_message: "", skip_reason: "", duration_ms: 0 }
  - { id: 8231, change_id: 1052, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8232, change_id: 1052, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: pending, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8233, change_id: 1052, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: pending, error_message: "", skip_reason: "", duration_ms: 0 }
  - { id: 8234, change_id: 1053, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8235, change_id: 1053, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: failed, error_message: "Step interrupted", skip_reason: "", duration_ms: 60000 }
  - { id: 8236, change_id: 1053, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
  - { id: 8237, change_id: 1054, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8238, change_id: 1054, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8239, change_id: 1054, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8240, change_id: 1055, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8241, change_id: 1055, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8242, change_id: 1055, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8243, change_id: 1056, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8244, change_id: 1056, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8245, change_id: 1056, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8246, change_id: 1057, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8247, change_id: 1057, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: failed, error_message: "Step execution failed", skip_reason: "", duration_ms: 60000 }
  - { id: 8248, change_id: 1057, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
  - { id: 8249, change_id: 1058, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8250, change_id: 1058, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8251, change_id: 1058, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: success, error_message: "", skip_reason: "", duration_ms: 60000 }
  - { id: 8252, change_id: 1059, filepath: "collect.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: failed, error_message: "Step execution failed", skip_reason: "", duration_ms: 60000 }
  - { id: 8253, change_id: 1059, filepath: "summarize.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
  - { id: 8254, change_id: 1059, filepath: "publish.sql", file_type: sql, checksum: "bbbbbbbb", cli_version: "1.0.0", status: skipped, error_message: "", skip_reason: "prior step did not complete", duration_ms: 0 }
---

# executions

Records individual files executed as part of a [[change|change operation]]. The synthetic examples include current nonpipeline operations and proposed pipeline invocations linked to [[pipeline_run]] and [[pipeline_step]]. These are independent snapshots, not event histories or production records.

## Rules and source

Every column is non-null. The required `change_id` foreign key references `change.id` with `ON DELETE CASCADE`; the migration also creates a non-unique index on it. The application types in `src/core/shared/tables.ts` define file types and statuses; the migration uses varchar columns without checks. In the examples, skipped execution 8105 was unreached after a failure, while 8108 was unchanged; the txt row 8106 is a manifest. Pipeline rows use `pending`, `success`, `failed`, or `skipped` as execution logs: transaction outcome belongs to the pipeline tables. An unreached pipeline step is skipped due to a prior failure or interruption, not because of an unchanged-file skip gate. Source: `src/core/version/schema/migrations/v1.ts` and `v2.ts`.
