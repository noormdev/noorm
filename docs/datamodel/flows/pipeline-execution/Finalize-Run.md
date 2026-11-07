---
process: Finalize Run
number: 4
description: Persist direct workflow evidence outside the workflow transaction, release any owned guard, and report the result.
inputs:
  - from: cache:execution-outcomes
    label: execution outcome
    data: run_id, slug, config_name, single_run, guard ownership if protected, confirmation that workflow SQL and transaction activity have settled before release, status, transaction_outcome, started_at, finished_at, duration_ms, error_message, declared step results with step_no, name, status, transaction_outcome, started_at, finished_at, duration_ms, error_message and skip_reason, errors
  - from: cluster:pipeline-history
    label: intended run
    data:
      pipeline_run: [id, slug, config_name, single_run, status, transaction_outcome, started_at, finished_at, error_message, duration_ms]
      pipeline_step: [pipeline_run_id, step_no, name, filepath, checksum, status, transaction_outcome, started_at, finished_at, error_message, skip_reason, duration_ms]
  - from: other:single-run-guard
    label: admission ownership
    data: config_name, slug, protected run identity and current ownership when protection was claimed
outputs:
  - to: cluster:pipeline-history
    label: finalized history
    data:
      pipeline_run: [id, status, transaction_outcome, started_at, finished_at, error_message, duration_ms]
      pipeline_step: [pipeline_run_id, step_no, status, transaction_outcome, started_at, finished_at, error_message, skip_reason, duration_ms]
  - to: other:single-run-guard
    label: ownership release
    data: config_name, slug, run identity, settled workflow evidence and ownership-safe release of protection, or retained protection requiring reconciliation or cleanup error
  - to: ext:Caller
    label: run summary
    data: run_id, slug, config_name, status, transaction_outcome, declared step numbers and names with status, transaction outcome, timings, duration, errors and skip reasons, run errors and result code
examples:
  in:
    - from: cache:execution-outcomes
      label: committed and uncertain outcomes
      rows:
        - { run_id: 1044, slug: refresh-reporting, config_name: dev, single_run: false, status: success, transaction_outcome: committed, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: committed }, { step_no: 2, name: summarize, status: success, transaction_outcome: committed }, { step_no: 3, name: publish, status: success, transaction_outcome: committed }], errors: [] }
        - { run_id: 1054, slug: refresh-reporting, config_name: dev, single_run: false, status: unknown, transaction_outcome: unknown, errors: [Commit acknowledgement lost] }
        - run_id: 1066
          slug: refresh-reporting
          config_name: staging
          single_run: true
          guard_owner_run_id: 1066
          workflow_settled: true
          status: success
          transaction_outcome: committed
          started_at: '2026-02-06T10:00:00Z'
          finished_at: '2026-02-06T10:03:00Z'
          duration_ms: 180000
          error_message: ''
          steps:
            - { step_no: 1, name: collect, status: success, transaction_outcome: committed, started_at: '2026-02-06T10:00:00Z', finished_at: '2026-02-06T10:01:00Z', duration_ms: 60000, error_message: '', skip_reason: '' }
            - { step_no: 2, name: summarize, status: success, transaction_outcome: committed, started_at: '2026-02-06T10:01:00Z', finished_at: '2026-02-06T10:02:00Z', duration_ms: 60000, error_message: '', skip_reason: '' }
            - { step_no: 3, name: publish, status: success, transaction_outcome: committed, started_at: '2026-02-06T10:02:00Z', finished_at: '2026-02-06T10:03:00Z', duration_ms: 60000, error_message: '', skip_reason: '' }
          errors: []
    - from: db:pipeline_run
      label: pending run snapshot
      rows:
        - { id: 1044, slug: refresh-reporting, config_name: dev, single_run: false, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', duration_ms: 0 }
        - { id: 1066, slug: refresh-reporting, config_name: staging, single_run: true, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', duration_ms: 0 }
    - from: db:pipeline_step
      label: pending step snapshot
      rows:
        - { pipeline_run_id: 1044, step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
        - { pipeline_run_id: 1066, step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
        - { pipeline_run_id: 1066, step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
        - { pipeline_run_id: 1066, step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
    - from: other:single-run-guard
      label: protected ownership
      rows:
        - { config_name: staging, slug: refresh-reporting, run_id: 1066, state: owned }
  out:
    - to: db:pipeline_run
      label: direct run outcomes
      rows:
        - { id: 1044, status: success, transaction_outcome: committed, started_at: '2026-01-12T10:00:00Z', finished_at: '2026-01-12T10:03:00Z', error_message: '', duration_ms: 180000 }
        - { id: 1054, status: unknown, transaction_outcome: unknown, started_at: '2026-01-22T10:00:00Z', finished_at: '2026-01-22T10:03:00Z', error_message: Transaction outcome unknown, duration_ms: 180000 }
        - { id: 1066, status: success, transaction_outcome: committed, started_at: '2026-02-06T10:00:00Z', finished_at: '2026-02-06T10:03:00Z', error_message: '', duration_ms: 180000 }
    - to: db:pipeline_step
      label: direct step outcomes
      rows:
        - { pipeline_run_id: 1044, step_no: 1, status: success, transaction_outcome: committed, started_at: '2026-01-12T10:00:00Z', finished_at: '2026-01-12T10:01:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1042, step_no: 2, status: failed, transaction_outcome: rolled_back, started_at: '2026-01-10T10:01:00Z', finished_at: '2026-01-10T10:02:00Z', error_message: Step execution failed, skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1066, step_no: 1, status: success, transaction_outcome: committed, started_at: '2026-02-06T10:00:00Z', finished_at: '2026-02-06T10:01:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1066, step_no: 2, status: success, transaction_outcome: committed, started_at: '2026-02-06T10:01:00Z', finished_at: '2026-02-06T10:02:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1066, step_no: 3, status: success, transaction_outcome: committed, started_at: '2026-02-06T10:02:00Z', finished_at: '2026-02-06T10:03:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
    - to: other:single-run-guard
      label: conditional release
      rows:
        - { config_name: staging, slug: refresh-reporting, run_id: 1066, workflow_settled: true, transaction_outcome: committed, action: release owned guard }
    - to: ext:Caller
      label: success and audit error
      rows:
        - { run_id: 1044, slug: refresh-reporting, config_name: dev, status: success, transaction_outcome: committed, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: committed }], errors: [], result: 0 }
        - { run_id: 1042, slug: refresh-reporting, config_name: dev, status: failed, transaction_outcome: rolled_back, errors: [Step execution failed, Audit update failed], result: 1 }
---

Persist [[pipeline_run]] and [[pipeline_step]] evidence in bookkeeping transactions separate from workflow transactions, including after each resolved `step` boundary. No generic history projections exist. Successful execution and eventual rollback are different facts; a lost acknowledgement or failed rollback remains unknown. Pending inputs are illustrative earlier snapshots of final examples, not separate historical claims.

Release an owned [[single-run-guard]] only after workflow SQL and transaction activity have settled, including when final bookkeeping fails. Ownership alone does not prove release is safe. The protected example receives the complete settled outcome for 1066 and updates its run and steps before release; pending 1062 is not finalized or unlocked here. If SQL activity may still be running, preserve protection for reconciliation rather than admitting overlapping work. Preserve the original execution error alongside audit or cleanup errors and do not report complete success if required audit fails. A crash can leave unresolved intent or ownership: recovery cannot infer commit, rollback, or safe expiration from a stale row. The guard is abstract, and recovery remains an open design. Normal responses exclude SQL and secrets.
