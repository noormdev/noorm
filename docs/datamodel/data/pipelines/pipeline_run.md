---
entity: pipeline_run
group: pipelines
description: "Proposed independent pipeline invocation and workflow outcome."
pk: [id]
columns:
  id: { type: integer, desc: "Generated independent identity for each admitted invocation." }
  slug: { type: text, desc: "Pipeline folder and manifest slug." }
  manifest_checksum: { type: text, desc: "Checksum of the manifest used for this invocation." }
  transaction_policy: { type: text, desc: "Workflow transaction policy: pipeline, step, or none." }
  status: { type: text, desc: "Authoritative pipeline run status." }
  transaction_outcome: { type: text, desc: "Recorded outcome of workflow transactions." }
  started_at: { type: timestamp, nullable: true, desc: "Execution start, null until execution begins." }
  finished_at: { type: timestamp, nullable: true, desc: "Resolution time, null until resolved." }
  config_name: { type: text, desc: "Resolved configuration name." }
  executed_by: { type: text, desc: "Executing identity string; not a foreign key." }
  cli_version: { type: text, desc: "Invoking version string." }
  created_at: { type: timestamp, desc: "Admission time, including before execution starts." }
  error_message: { type: text, default: "", desc: "Run error details or empty when absent." }
  duration_ms: { type: integer, default: 0, desc: "Elapsed execution milliseconds; zero before start." }
  single_run: { type: boolean, default: false, desc: "Proposed audit snapshot of opt-in single-run protection, not settled manifest syntax." }
examples:
  - { id: 1042, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "failed", transaction_outcome: "rolled_back", started_at: "2026-01-10T10:00:00Z", finished_at: "2026-01-10T10:02:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-10T10:00:00Z", error_message: "Pipeline did not complete successfully", duration_ms: 120000, single_run: false }
  - { id: 1043, slug: "refresh-reporting", manifest_checksum: "eeeeeeee", transaction_policy: "step", status: "partial", transaction_outcome: "partial", started_at: "2026-01-11T10:00:00Z", finished_at: "2026-01-11T10:02:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-11T10:00:00Z", error_message: "Pipeline did not complete successfully", duration_ms: 120000, single_run: false }
  - { id: 1044, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "success", transaction_outcome: "committed", started_at: "2026-01-12T10:00:00Z", finished_at: "2026-01-12T10:03:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-12T10:00:00Z", error_message: "", duration_ms: 180000, single_run: false }
  - { id: 1045, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "failed", transaction_outcome: "rolled_back", started_at: "2026-01-13T10:00:00Z", finished_at: "2026-01-13T10:01:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-13T10:00:00Z", error_message: "Pipeline did not complete successfully", duration_ms: 60000, single_run: false }
  - { id: 1046, slug: "refresh-reporting", manifest_checksum: "eeeeeeee", transaction_policy: "step", status: "success", transaction_outcome: "committed", started_at: "2026-01-14T10:00:00Z", finished_at: "2026-01-14T10:03:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-14T10:00:00Z", error_message: "", duration_ms: 180000, single_run: false }
  - { id: 1047, slug: "refresh-reporting", manifest_checksum: "eeeeeeee", transaction_policy: "step", status: "failed", transaction_outcome: "rolled_back", started_at: "2026-01-15T10:00:00Z", finished_at: "2026-01-15T10:01:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-15T10:00:00Z", error_message: "Pipeline did not complete successfully", duration_ms: 60000, single_run: false }
  - { id: 1048, slug: "refresh-reporting", manifest_checksum: "ffffffff", transaction_policy: "none", status: "success", transaction_outcome: "committed", started_at: "2026-01-16T10:00:00Z", finished_at: "2026-01-16T10:03:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-16T10:00:00Z", error_message: "", duration_ms: 180000, single_run: false }
  - { id: 1049, slug: "refresh-reporting", manifest_checksum: "ffffffff", transaction_policy: "none", status: "partial", transaction_outcome: "partial", started_at: "2026-01-17T10:00:00Z", finished_at: "2026-01-17T10:01:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-17T10:00:00Z", error_message: "Pipeline did not complete successfully", duration_ms: 60000, single_run: false }
  - { id: 1050, slug: "refresh-reporting", manifest_checksum: "ffffffff", transaction_policy: "none", status: "partial", transaction_outcome: "partial", started_at: "2026-01-18T10:00:00Z", finished_at: "2026-01-18T10:02:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-18T10:00:00Z", error_message: "Pipeline did not complete successfully", duration_ms: 120000, single_run: false }
  - { id: 1051, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "pending", transaction_outcome: "pending", started_at: null, finished_at: null, config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-19T10:00:00Z", error_message: "", duration_ms: 0, single_run: false }
  - { id: 1052, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "running", transaction_outcome: "pending", started_at: "2026-01-20T10:00:00Z", finished_at: null, config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-20T10:00:00Z", error_message: "", duration_ms: 120000, single_run: false }
  - { id: 1053, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "interrupted", transaction_outcome: "rolled_back", started_at: "2026-01-21T10:00:00Z", finished_at: "2026-01-21T10:02:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-21T10:00:00Z", error_message: "Pipeline did not complete successfully", duration_ms: 120000, single_run: false }
  - { id: 1054, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "unknown", transaction_outcome: "unknown", started_at: "2026-01-22T10:00:00Z", finished_at: "2026-01-22T10:03:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-22T10:00:00Z", error_message: "Transaction outcome unknown", duration_ms: 180000, single_run: false }
  - { id: 1055, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "pending", transaction_outcome: "unknown", started_at: "2026-01-23T10:00:00Z", finished_at: null, config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-23T10:00:00Z", error_message: "", duration_ms: 180000, single_run: false }
  - { id: 1056, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "success", transaction_outcome: "committed", started_at: "2026-01-24T10:00:00Z", finished_at: "2026-01-24T10:03:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-24T10:00:00Z", error_message: "", duration_ms: 180000, single_run: false }
  - { id: 1057, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "unknown", transaction_outcome: "unknown", started_at: "2026-01-25T10:00:00Z", finished_at: "2026-01-25T10:02:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-25T10:00:00Z", error_message: "Transaction outcome unknown", duration_ms: 120000, single_run: false }
  - { id: 1058, slug: "refresh-reporting", manifest_checksum: "dddddddd", transaction_policy: "pipeline", status: "success", transaction_outcome: "committed", started_at: "2026-01-26T10:00:00Z", finished_at: "2026-01-26T10:03:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-26T10:00:00Z", error_message: "", duration_ms: 180000, single_run: false }
  - { id: 1059, slug: "refresh-reporting", manifest_checksum: "ffffffff", transaction_policy: "none", status: "failed", transaction_outcome: "no_effects", started_at: "2026-01-27T10:00:00Z", finished_at: "2026-01-27T10:01:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-01-27T10:00:00Z", error_message: "Pipeline did not complete successfully", duration_ms: 60000, single_run: false }
  - { id: 1060, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "success", transaction_outcome: "committed", started_at: "2026-02-01T10:00:00Z", finished_at: "2026-02-01T10:03:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-02-01T10:00:00Z", error_message: "", duration_ms: 180000, single_run: false }
  - { id: 1061, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "success", transaction_outcome: "committed", started_at: "2026-02-01T10:01:00Z", finished_at: "2026-02-01T10:04:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-02-01T10:01:00Z", error_message: "", duration_ms: 180000, single_run: false }
  - { id: 1062, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "pending", transaction_outcome: "pending", started_at: null, finished_at: null, config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-02-02T10:00:00Z", error_message: "", duration_ms: 0, single_run: true }
  - { id: 1063, slug: "load-erp", manifest_checksum: "1234abcd", transaction_policy: "pipeline", status: "success", transaction_outcome: "committed", started_at: "2026-02-03T10:00:00Z", finished_at: "2026-02-03T10:04:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-02-03T10:00:00Z", error_message: "", duration_ms: 240000, single_run: false }
  - { id: 1064, slug: "load-erp", manifest_checksum: "2345abcd", transaction_policy: "step", status: "partial", transaction_outcome: "partial", started_at: "2026-02-04T10:00:00Z", finished_at: "2026-02-04T10:03:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-02-04T10:00:00Z", error_message: "Account cleaning failed", duration_ms: 180000, single_run: false }
  - { id: 1065, slug: "load-local", manifest_checksum: "3456abcd", transaction_policy: "step", status: "success", transaction_outcome: "committed", started_at: "2026-02-05T10:00:00Z", finished_at: "2026-02-05T10:03:00Z", config_name: "dev", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-02-05T10:00:00Z", error_message: "", duration_ms: 180000, single_run: false }
  - { id: 1066, slug: "refresh-reporting", manifest_checksum: "cccccccc", transaction_policy: "pipeline", status: "success", transaction_outcome: "committed", started_at: "2026-02-06T10:00:00Z", finished_at: "2026-02-06T10:03:00Z", config_name: "staging", executed_by: "synthetic-operator", cli_version: "1.0.0", created_at: "2026-02-06T10:00:00Z", error_message: "", duration_ms: 180000, single_run: true }
---

# pipeline_run

**Proposal, not an existing database table.** Each admitted invocation owns a new independent identity and its [[pipeline_step|step evidence]]. No pipeline rows are written to [[change]] or [[executions]]; retention of pipeline history is independent of change history. There is no database registry of definitions: a folder and manifest define the workflow.

## Rules and lifecycle

- `created_at` records admission; `started_at` and `finished_at` are null until execution starts or the run resolves, respectively. Identity, config, invoking version, timing, error, workflow status and transaction outcome are recorded directly here, not projected into generic history.
- A manifest checksum identifies the prepared definition, not an applied-state gate. Every fresh invocation starts anew; it never resumes or skips steps because an earlier invocation ran the same files.
- Overlap is allowed by default. When `single_run` is enabled, at most one pending or running invocation for a resolved config and slug may be admitted. The flag is a proposed audit snapshot, not settled manifest or SDK syntax. Atomic admission with pending intent, ownership and crash recovery are required; the mechanism remains open. Existing [[lock]] uniqueness per config cannot provide this scope. This is not business idempotency: SQL owns domain guards and uniqueness.
- Persist the run and intended steps before workflow transactions; buffer and persist audit independently so rollback does not erase it. Finalization may fail or be uncertain. Preserve the original execution error across rollback or cleanup failures and never infer a commit or rollback from pending history. Preflight rejection, denial, contention and dry-run create no run in the current proposal.
- `pending` and `running` are unresolved, `partial` means confirmed effects survive alongside failure, `interrupted` means work stopped before normal completion, and `unknown` means transaction outcome cannot be established. Outcomes `pending`, `committed`, `rolled_back`, `partial`, `no_effects`, and `unknown` express transaction certainty; `no_effects` does not claim a rollback under `none`.

Source: the pipeline design discussion and `docs/design/sql-pipelines.md`. Business operations own their history independently of schema evolution. The guard prevents overlapping work only; SQL still enforces domain repeatability. Retention must remove or retain a run and its steps coherently, without involving generic change history; deletion policy remains open.

## Illustrative examples

These are synthetic snapshots, not production records or an update log. Example checksums are abbreviated to eight characters for readability only. Each run has matching [[pipeline_step|steps]], including unstarted declarations.

| Run | Policy | Scenario |
| --- | --- | --- |
| 1042 | `pipeline` | Later failure rolls back the entire workflow transaction. |
| 1043 | `step` | Collect commits; summarize fails and rolls back. |
| 1044 | `pipeline` | All steps execute and the transaction commits. |
| 1045 | `pipeline` | First-step failure rolls back; later steps are skipped. |
| 1046 | `step` | Every step transaction commits. |
| 1047 | `step` | First-step transaction rolls back; later steps are skipped. |
| 1048 | `none` | All steps succeed without a wrapping transaction. |
| 1049 | `none` | First step fails after confirmed partial effects. |
| 1050 | `none` | A prior commit survives a later failure with no effects of its own. |
| 1051 | `pipeline` | Pending intent is durable before execution starts. |
| 1052 | `pipeline` | Collect succeeded and summarize is running; transaction remains pending. |
| 1053 | `pipeline` | Interruption followed by confirmed rollback. |
| 1054 | `pipeline` | Commit acknowledgement is lost; outcome remains unknown. |
| 1055 | `pipeline` | Audit finalization gap, without a claimed commit or rollback. |
| 1056 | `pipeline` | Fresh invocation of the unchanged manifest from 1044. |
| 1057 | `pipeline` | Later execution failure and rollback failure leave an unknown outcome. |
| 1058 | `pipeline` | Two declarations execute the same file under distinct names and positions. |
| 1059 | `none` | First-step failure with confirmed no effects. |
| 1060–1061 | `pipeline` | Same config and slug overlap with protection disabled; each run has its own transaction. |
| 1062 | `pipeline` | Protected pending intent makes a competing protected admission busy. |
| 1063 | `pipeline` | A diamond dependency graph executes serially on one session. |
| 1064 | `step` | Parallel branches settle after failure; committed effects remain and aggregate is skipped. |
| 1065 | `step` | Templates consume neighboring CSV, JSON, and YAML explicitly, without automatic imports. |
| 1066 | `pipeline` | Protected staging run completes and commits before its owned guard is released; pending dev run 1062 remains a separate case. |
