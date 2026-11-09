---
process: Reserve Run
number: 2
description: Admit a fresh run and persist intended steps, optionally coordinating single-run protection.
inputs:
  - from: cache:prepared-invocations
    label: prepared invocation
    data: slug, config_name, executed_by, cli_version, transaction_policy, manifest_checksum, single_run, order_mode, concurrency cap, immutable resolved input, declared steps with step_no, name, filepath, rendered checksum, prepared SQL and numeric needs, dry_run=false
  - from: db:pipeline_run
    label: admission state
    data: [id, config_name, slug, active_key, status]
outputs:
  - to: cluster:pipeline-history
    label: intended run
    data:
      pipeline_run: [id, slug, config_name, executed_by, cli_version, created_at, manifest_checksum, transaction_policy, single_run, active_key, status, transaction_outcome, started_at, finished_at, error_message, duration_ms]
      pipeline_step: [pipeline_run_id, step_no, name, filepath, checksum, needs, status, transaction_outcome, started_at, finished_at, error_message, skip_reason, duration_ms]
  - to: cache:active-runs
    label: reserved run
    data: run_id, slug, config_name, executed_by, cli_version, transaction_policy, manifest_checksum, single_run, active_key, order_mode, concurrency cap, immutable resolved input, declared steps with step_no, name, filepath, rendered checksum, prepared SQL and numeric needs
  - to: ext:Caller
    label: reservation failure
    data: slug, config_name, status, errors
examples:
  in:
    - from: cache:prepared-invocations
      label: prepared request
      rows:
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', transaction_policy: pipeline, manifest_checksum: cccccccc, single_run: false, order_mode: linear, concurrency_cap: 1, input: { region: east }, dry_run: false, steps: [{ step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, sql: 'SELECT 1', needs: [] }, { step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, sql: 'SELECT 2', needs: [1] }, { step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, sql: 'SELECT 3', needs: [2] }] }
    - from: db:pipeline_run
      label: pending protected owner
      rows:
        - { id: 1062, config_name: dev, slug: refresh-reporting, active_key: 7dceed79baa9e6b3990466eb7dab7e376e779ebd7dbecb250417ea80bd8c2b6a, status: pending }
  out:
    - to: db:pipeline_run
      label: pending run snapshot
      rows:
        - { id: 1044, slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', created_at: '2026-01-12T10:00:00Z', manifest_checksum: cccccccc, transaction_policy: pipeline, single_run: false, active_key: null, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', duration_ms: 0 }
    - to: db:pipeline_step
      label: pending step snapshots
      rows:
        - { pipeline_run_id: 1044, step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, needs: '[]', status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
        - { pipeline_run_id: 1044, step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, needs: '[1]', status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
        - { pipeline_run_id: 1044, step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, needs: '[2]', status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
    - to: cache:active-runs
      label: admitted invocation
      rows:
        - { run_id: 1044, slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', transaction_policy: pipeline, manifest_checksum: cccccccc, single_run: false, active_key: null, order_mode: linear, concurrency_cap: 1, input: { region: east }, steps: [{ step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, sql: 'SELECT 1', needs: [] }, { step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, sql: 'SELECT 2', needs: [1] }, { step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, sql: 'SELECT 3', needs: [2] }] }
    - to: ext:Caller
      label: contention or audit failure
      rows:
        - { slug: refresh-reporting, config_name: dev, status: busy, errors: [protected invocation already pending or running] }
        - { slug: refresh-reporting, config_name: dev, status: failed, errors: [failed to persist intended audit] }
---

Create an independent [[pipeline_run]] and all intended [[pipeline_step]] rows in one bookkeeping transaction before workflow SQL. Protected admission stores SHA-256 of JSON `[config_name, slug]` in that same run row's unique `active_key`; unprotected runs use null. A collision rolls back the entire intent and reports busy, without a new run or step. Pending 1062 therefore blocks another protected request, while unprotected 1060 and 1061 may overlap. The manifest's `singleRun` choice cannot be disabled by a caller.

Persist numeric `needs` as JSON text, not input values or SQL. If intent persistence fails, report the error and do not start SQL. Publish [[active-runs]] only after intent is durable. Pending rows remain unchanged while outcomes are buffered; they do not prove workflow SQL has not started. In the illustrative 1062 cleanup-failure case, ownership remains and a protected rerun is busy, without claiming that business work committed. Rows above are illustrative pending snapshots of 1044, not its final state; checksum abbreviations are eight characters.
