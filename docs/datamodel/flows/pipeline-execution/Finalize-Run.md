---
process: Finalize Run
number: 4
description: Record observed workflow outcomes outside the workflow transaction, release the owned lock, and report the result.
inputs:
  - from: cache:execution-outcomes
    label: execution outcome
    data: run_id, config_name, status, transaction_outcome, ordered steps with step_no, name, status, transaction_outcome, started_at and finished_at, errors
  - from: cluster:pipeline-history
    label: intended run
    data:
      change: [id, name, status, error_message, duration_ms, config_name, executed_by]
      executions: [id, change_id, filepath, status, error_message, skip_reason, duration_ms]
      pipeline_run: [id, slug, status, transaction_outcome, started_at, finished_at]
      pipeline_step: [pipeline_run_id, step_no, execution_id, name, status, transaction_outcome, started_at, finished_at]
  - from: db:lock
    label: owned lock
    data: [id, config_name, locked_by, locked_at, expires_at, reason]
outputs:
  - to: cluster:pipeline-history
    label: finalized history
    data:
      change: [id, status, error_message, duration_ms]
      executions: [id, change_id, status, error_message, skip_reason, duration_ms]
      pipeline_run: [id, status, transaction_outcome, started_at, finished_at]
      pipeline_step: [pipeline_run_id, step_no, execution_id, status, transaction_outcome, started_at, finished_at]
  - to: db:lock
    label: released lock
    data: [id, config_name, locked_by]
  - to: ext:Caller
    label: run summary
    data: run_id, slug, config_name, status, transaction_outcome, ordered steps with step_no, name, status and transaction_outcome, errors, nonzero result on failure or audit error
examples:
  in:
    - from: cache:execution-outcomes
      label: committed and uncertain outcomes
      rows:
        - { run_id: 1044, config_name: dev, status: success, transaction_outcome: committed, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: committed }, { step_no: 2, name: summarize, status: success, transaction_outcome: committed }, { step_no: 3, name: publish, status: success, transaction_outcome: committed }], errors: [] }
        - { run_id: 1054, config_name: dev, status: unknown, transaction_outcome: unknown, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: unknown }, { step_no: 2, name: summarize, status: success, transaction_outcome: unknown }, { step_no: 3, name: publish, status: success, transaction_outcome: unknown }], errors: ['Commit acknowledgement lost'] }
    - from: db:change
      label: pending parent before finalization
      rows:
        - { id: 1044, name: refresh-reporting, status: pending, error_message: '', duration_ms: 0, config_name: dev, executed_by: synthetic-operator }
        - { id: 1042, name: refresh-reporting, status: pending, error_message: '', duration_ms: 0, config_name: dev, executed_by: synthetic-operator }
    - from: db:executions
      label: pending file records
      rows:
        - { id: 8207, change_id: 1044, filepath: collect.sql, status: pending, error_message: '', skip_reason: '', duration_ms: 0 }
        - { id: 8202, change_id: 1042, filepath: summarize.sql, status: pending, error_message: '', skip_reason: '', duration_ms: 0 }
    - from: db:pipeline_run
      label: pending runs
      rows:
        - { id: 1044, slug: refresh-reporting, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
        - { id: 1042, slug: refresh-reporting, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
    - from: db:pipeline_step
      label: pending steps
      rows:
        - { pipeline_run_id: 1044, step_no: 1, execution_id: 8207, name: collect, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
        - { pipeline_run_id: 1042, step_no: 2, execution_id: 8202, name: summarize, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
    - from: db:lock
      label: illustrative owned locks
      rows:
        - { id: 10, config_name: dev, locked_by: synthetic-operator, locked_at: '2026-01-12 10:00:00', expires_at: '2026-01-12 10:10:00', reason: pipeline }
        - { id: 11, config_name: dev, locked_by: synthetic-operator, locked_at: '2026-01-10 10:00:00', expires_at: '2026-01-10 10:10:00', reason: pipeline }
  out:
    - to: db:change
      label: generic status projections
      rows:
        - { id: 1044, status: success, error_message: '', duration_ms: 180000 }
        - { id: 1042, status: failed, error_message: 'Pipeline did not complete successfully', duration_ms: 120000 }
        - { id: 1054, status: failed, error_message: 'Transaction outcome unknown', duration_ms: 180000 }
    - to: db:executions
      label: recorded file results
      rows:
        - { id: 8207, change_id: 1044, status: success, error_message: '', skip_reason: '', duration_ms: 60000 }
        - { id: 8202, change_id: 1042, status: failed, error_message: 'Step execution failed', skip_reason: '', duration_ms: 60000 }
        - { id: 8206, change_id: 1043, status: skipped, error_message: '', skip_reason: 'prior step did not complete', duration_ms: 0 }
    - to: db:pipeline_run
      label: authoritative run outcomes
      rows:
        - { id: 1044, status: success, transaction_outcome: committed, started_at: '2026-01-12T10:00:00Z', finished_at: '2026-01-12T10:03:00Z' }
        - { id: 1043, status: partial, transaction_outcome: partial, started_at: '2026-01-11T10:00:00Z', finished_at: '2026-01-11T10:02:00Z' }
        - { id: 1054, status: unknown, transaction_outcome: unknown, started_at: '2026-01-22T10:00:00Z', finished_at: '2026-01-22T10:03:00Z' }
    - to: db:pipeline_step
      label: authoritative step outcomes
      rows:
        - { pipeline_run_id: 1044, step_no: 1, execution_id: 8207, status: success, transaction_outcome: committed, started_at: '2026-01-12T10:00:00Z', finished_at: '2026-01-12T10:01:00Z' }
        - { pipeline_run_id: 1042, step_no: 1, execution_id: 8201, status: success, transaction_outcome: rolled_back, started_at: '2026-01-10T10:00:00Z', finished_at: '2026-01-10T10:01:00Z' }
        - { pipeline_run_id: 1043, step_no: 2, execution_id: 8205, status: failed, transaction_outcome: rolled_back, started_at: '2026-01-11T10:01:00Z', finished_at: '2026-01-11T10:02:00Z' }
    - to: db:lock
      label: keys of owned locks to delete
      rows:
        - { id: 10, config_name: dev, locked_by: synthetic-operator }
        - { id: 11, config_name: dev, locked_by: synthetic-operator }
    - to: ext:Caller
      label: success and audit error
      rows:
        - { run_id: 1044, slug: refresh-reporting, config_name: dev, status: success, transaction_outcome: committed, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: committed }, { step_no: 2, name: summarize, status: success, transaction_outcome: committed }, { step_no: 3, name: publish, status: success, transaction_outcome: committed }], errors: [], result: 0 }
        - { run_id: 1042, slug: refresh-reporting, config_name: dev, status: failed, transaction_outcome: rolled_back, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: rolled_back }, { step_no: 2, name: summarize, status: failed, transaction_outcome: rolled_back }, { step_no: 3, name: publish, status: skipped, transaction_outcome: not_started }], errors: ['Step execution failed', 'Audit update failed'], result: 1 }
---

Use the buffered [[execution-outcomes]] and intended [[pipeline-history]] to update all four linked history members in a coherent bookkeeping transaction outside the workflow transaction. Pipeline run and step statuses and transaction outcomes are authoritative; generic [[change]] and [[executions]] statuses are projections. Preserve successful execution separately from a later rollback and preserve uncertainty when the engine cannot confirm commit or rollback. Result examples are independent model-seeded snapshots; pending inputs are illustrative earlier lifecycle transformations, not asserted historical records.

Release only the [[lock]] still owned by this invocation: delete the row identified by `id` with matching `config_name` and `locked_by`, not a fabricated action column. Lock IDs 10 and 11 are synthetic examples at different times, not simultaneous dev locks. Release is attempted even when audit finalization fails, without deleting another holder's lock. Report both the original workflow error and any audit or lock-release error; audit failure produces a nonzero response even when SQL succeeded. Normal results exclude SQL and secrets.

A crash or failed bookkeeping transaction can leave pending history and an unreleased lock; neither this diagram nor an attempted cleanup guarantees finalization. Distinguish a pending audit gap from a confirmed transaction outcome, and never manufacture commit or rollback certainty. These flows describe data movement rather than a control-flow guarantee; diagram process numbers are not pipeline step identities. Checksums in examples are abbreviated to eight characters.
