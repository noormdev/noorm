---
process: Reserve Run
number: 2
description: Acquire the pipeline-scoped lock and persist the intended run and step audit before execution.
inputs:
  - from: cache:prepared-invocations
    label: prepared invocation
    data: slug, config_name, executed_by, transaction_policy, manifest_checksum, ordered steps with step_no, name, path, sql_checksum and prepared SQL, dry_run=false
  - from: db:lock
    label: existing lock
    data: [id, config_name, locked_by, locked_at, expires_at, reason]
outputs:
  - to: db:lock
    label: acquired lock
    data: [id, config_name, locked_by, locked_at, expires_at, reason]
  - to: cluster:pipeline-history
    label: intended run
    data:
      change: [id, name, change_type, direction, checksum, executed_at, executed_by, config_name, cli_version, status, error_message, duration_ms]
      executions: [id, change_id, filepath, file_type, checksum, cli_version, status, error_message, skip_reason, duration_ms]
      pipeline_run: [id, slug, manifest_checksum, transaction_policy, status, transaction_outcome, started_at, finished_at]
      pipeline_step: [pipeline_run_id, step_no, execution_id, name, status, transaction_outcome, started_at, finished_at]
  - to: cache:active-runs
    label: reserved run
    data: run_id, slug, config_name, executed_by, transaction_policy, ordered steps with step_no, name, path, sql_checksum and prepared SQL
  - to: ext:Caller
    label: reservation failure
    data: slug, config_name, status, errors
examples:
  in:
    - from: cache:prepared-invocations
      label: prepared requests
      rows:
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, transaction_policy: pipeline, manifest_checksum: cccccccc, dry_run: false, steps: [{ step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 1' }, { step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 2' }, { step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 3' }] }
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, transaction_policy: step, manifest_checksum: eeeeeeee, dry_run: false, steps: [{ step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 1' }, { step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 2' }, { step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 3' }] }
    - from: db:lock
      label: occupied configuration
      rows:
        - { id: 1, config_name: dev, locked_by: alice@example.invalid, locked_at: '2026-01-01 10:00:00', expires_at: '2026-01-01 10:10:00', reason: build }
        - { id: 2, config_name: staging, locked_by: bob@example.invalid, locked_at: '2026-01-01 09:45:00', expires_at: '2026-01-01 09:55:00', reason: '' }
  out:
    - to: db:lock
      label: illustrative acquired lock
      rows:
        - { id: 10, config_name: dev, locked_by: synthetic-operator, locked_at: '2026-01-12 10:00:00', expires_at: '2026-01-12 10:10:00', reason: pipeline }
    - to: db:change
      label: pending parent
      rows:
        - { id: 1044, name: refresh-reporting, change_type: pipeline, direction: change, checksum: aaaaaaaa, executed_at: '2026-01-12T10:00:00Z', executed_by: synthetic-operator, config_name: dev, cli_version: '1.0.0', status: pending, error_message: '', duration_ms: 0 }
    - to: db:executions
      label: pending file records
      rows:
        - { id: 8207, change_id: 1044, filepath: collect.sql, file_type: sql, checksum: bbbbbbbb, cli_version: '1.0.0', status: pending, error_message: '', skip_reason: '', duration_ms: 0 }
        - { id: 8208, change_id: 1044, filepath: summarize.sql, file_type: sql, checksum: bbbbbbbb, cli_version: '1.0.0', status: pending, error_message: '', skip_reason: '', duration_ms: 0 }
        - { id: 8209, change_id: 1044, filepath: publish.sql, file_type: sql, checksum: bbbbbbbb, cli_version: '1.0.0', status: pending, error_message: '', skip_reason: '', duration_ms: 0 }
    - to: db:pipeline_run
      label: pending run
      rows:
        - { id: 1044, slug: refresh-reporting, manifest_checksum: cccccccc, transaction_policy: pipeline, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
    - to: db:pipeline_step
      label: pending ordered steps
      rows:
        - { pipeline_run_id: 1044, step_no: 1, execution_id: 8207, name: collect, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
        - { pipeline_run_id: 1044, step_no: 2, execution_id: 8208, name: summarize, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
        - { pipeline_run_id: 1044, step_no: 3, execution_id: 8209, name: publish, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
    - to: cache:active-runs
      label: run ready for execution
      rows:
        - { run_id: 1044, slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, transaction_policy: pipeline, steps: [{ step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 1' }, { step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 2' }, { step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 3' }] }
    - to: ext:Caller
      label: lock conflict and audit failure
      rows:
        - { slug: refresh-reporting, config_name: dev, status: rejected, errors: [configuration locked] }
        - { slug: refresh-reporting, config_name: dev, status: failed, errors: [failed to persist intended audit] }
---

Inspect [[lock]] for the selected configuration and acquire a lock scoped to this config and pipeline, so an unrelated application pipeline can run at the same time. The existing table's unique configuration scope is a proposed extension, not current schema. A lock conflict returns a rejection without creating any history. On successful acquisition, persist [[change]], [[executions]], [[pipeline_run]], and [[pipeline_step]] as a coherent bookkeeping transaction outside the workflow transaction. The run shares the change ID; every ordered step has a distinct execution record. Publish [[active-runs]] only after this intent is durable. This cache is ephemeral, not a database table or a resume checkpoint.

If intent persistence fails, report the audit error and release the owned lock where possible; do not start workflow SQL. Lock and audit failures must not be represented as a successful reservation. The pending 1044 records above are illustrative lifecycle transformations of the model's final 1044 examples, not claims about historical snapshots; lock 10 and SQL are synthetic. Checksums are abbreviated to eight characters.
