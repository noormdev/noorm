---
process: Reserve Run
number: 2
description: Admit a fresh run and persist intended steps, optionally coordinating single-run protection.
inputs:
  - from: cache:prepared-invocations
    label: prepared invocation
    data: slug, config_name, executed_by, cli_version, transaction_policy, manifest_checksum, single_run, order_mode, concurrency cap, declared steps with step_no, name, filepath, rendered checksum, prepared SQL and needs when graph, dry_run=false
  - from: other:single-run-guard
    label: admission state
    data: config_name, slug, protection requested, ownership and unresolved active state for protected admission
outputs:
  - to: other:single-run-guard
    label: admission ownership
    data: config_name, slug, protected admission claim and ownership associated with pending run, or busy result
  - to: cluster:pipeline-history
    label: intended run
    data:
      pipeline_run: [id, slug, config_name, executed_by, cli_version, created_at, manifest_checksum, transaction_policy, single_run, status, transaction_outcome, started_at, finished_at, error_message, duration_ms]
      pipeline_step: [pipeline_run_id, step_no, name, filepath, checksum, status, transaction_outcome, started_at, finished_at, error_message, skip_reason, duration_ms]
  - to: cache:active-runs
    label: reserved run
    data: run_id, slug, config_name, executed_by, cli_version, transaction_policy, manifest_checksum, single_run, guard ownership if protected, order_mode, concurrency cap, declared steps with step_no, name, filepath, rendered checksum, prepared SQL and needs when graph
  - to: ext:Caller
    label: reservation failure
    data: slug, config_name, status, errors
examples:
  in:
    - from: cache:prepared-invocations
      label: prepared request
      rows:
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', transaction_policy: pipeline, manifest_checksum: cccccccc, single_run: false, order_mode: linear, concurrency_cap: 1, dry_run: false, steps: [{ step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, sql: 'SELECT 1' }, { step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, sql: 'SELECT 2' }, { step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, sql: 'SELECT 3' }] }
    - from: other:single-run-guard
      label: pending protected owner
      rows:
        - { config_name: dev, slug: refresh-reporting, protection_requested: true, state: pending, owner_run_id: 1062 }
  out:
    - to: other:single-run-guard
      label: competing admission
      rows:
        - { config_name: dev, slug: refresh-reporting, result: busy, owner_run_id: 1062 }
    - to: db:pipeline_run
      label: pending run snapshot
      rows:
        - { id: 1044, slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', created_at: '2026-01-12T10:00:00Z', manifest_checksum: cccccccc, transaction_policy: pipeline, single_run: false, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', duration_ms: 0 }
    - to: db:pipeline_step
      label: pending step snapshots
      rows:
        - { pipeline_run_id: 1044, step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
        - { pipeline_run_id: 1044, step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
        - { pipeline_run_id: 1044, step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
    - to: cache:active-runs
      label: admitted invocation
      rows:
        - { run_id: 1044, slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', transaction_policy: pipeline, manifest_checksum: cccccccc, single_run: false, order_mode: linear, concurrency_cap: 1, steps: [{ step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, sql: 'SELECT 1' }, { step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, sql: 'SELECT 2' }, { step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, sql: 'SELECT 3' }] }
    - to: ext:Caller
      label: contention or audit failure
      rows:
        - { slug: refresh-reporting, config_name: dev, status: busy, errors: [protected invocation already pending or running] }
        - { slug: refresh-reporting, config_name: dev, status: failed, errors: [failed to persist intended audit] }
---

Create an independent [[pipeline_run]] and all intended [[pipeline_step]] rows before workflow SQL. By default there is no overlap restriction; runs 1060 and 1061 can overlap for the same config and slug. When `single_run` is opted in, claim the abstract [[single-run-guard]] atomically with pending intent or by an equivalent race-free protocol; pending 1062 blocks a competing protected request without fabricating a rejected run row. Scope is config plus slug, not the existing config-unique [[lock]]. Ownership and stale recovery mechanisms remain open and must account for potentially running SQL and unresolved audit.

If intent persistence fails, report the audit error, release any owned guard where possible and do not start SQL. Publish [[active-runs]] only after intent is durable. Rows above are illustrative pending snapshots of 1044, not its final state; checksum abbreviations are eight characters.
