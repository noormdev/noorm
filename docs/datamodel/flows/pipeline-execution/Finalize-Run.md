---
process: Finalize Run
number: 4
description: Persist settled workflow evidence independently, retain uncertain ownership, and report the result.
inputs:
  - from: cache:execution-outcomes
    label: execution outcome
    data: run_id, slug, config_name, single_run, active_key, workflow_settled, status, transaction_outcome, started_at, finished_at, duration_ms, error_message, declared step results with step_no, name, status, transaction_outcome, started_at, finished_at, duration_ms, error_message and skip_reason, primary and secondary errors
  - from: cluster:pipeline-history
    label: intended run
    data:
      pipeline_run: [id, slug, config_name, single_run, active_key, status, transaction_outcome, started_at, finished_at, error_message, duration_ms]
      pipeline_step: [pipeline_run_id, step_no, name, filepath, checksum, needs, status, transaction_outcome, started_at, finished_at, error_message, skip_reason, duration_ms]
outputs:
  - to: cluster:pipeline-history
    label: finalized history
    data:
      pipeline_run: [id, active_key, status, transaction_outcome, started_at, finished_at, error_message, duration_ms]
      pipeline_step: [pipeline_run_id, step_no, status, transaction_outcome, started_at, finished_at, error_message, skip_reason, duration_ms]
  - to: ext:Caller
    label: run summary
    data: run_id, slug, config_name, status, transaction_outcome, declared step numbers and names with status, transaction outcome, timings, duration, errors and skip reasons, run errors and result code
examples:
  in:
    - from: cache:execution-outcomes
      label: committed and uncertain outcomes
      rows:
        - { run_id: 1044, slug: refresh-reporting, config_name: dev, single_run: false, active_key: null, workflow_settled: true, status: success, transaction_outcome: committed, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: committed }, { step_no: 2, name: summarize, status: success, transaction_outcome: committed }, { step_no: 3, name: publish, status: success, transaction_outcome: committed }], errors: [] }
        - { run_id: 1054, slug: refresh-reporting, config_name: dev, single_run: false, active_key: null, workflow_settled: true, status: unknown, transaction_outcome: unknown, errors: [Commit acknowledgement lost] }
        - { run_id: 1062, slug: refresh-reporting, config_name: dev, single_run: true, active_key: 7dceed79baa9e6b3990466eb7dab7e376e779ebd7dbecb250417ea80bd8c2b6a, workflow_settled: false, status: unknown, transaction_outcome: unknown, errors: [Step execution failed, Rollback failed] }
        - { run_id: 1068, slug: refresh-reporting, config_name: staging, single_run: true, active_key: f955fcfb62e91cda12451f51c5619a315a3869f9de0ff24c6a75b04059d80dcb, workflow_settled: true, status: failed, transaction_outcome: no_effects, errors: [Workflow connection failed] }
        - run_id: 1066
          slug: refresh-reporting
          config_name: staging
          single_run: true
          active_key: f955fcfb62e91cda12451f51c5619a315a3869f9de0ff24c6a75b04059d80dcb
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
        - { id: 1044, slug: refresh-reporting, config_name: dev, single_run: false, active_key: null, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', duration_ms: 0 }
        - { id: 1062, slug: refresh-reporting, config_name: dev, single_run: true, active_key: 7dceed79baa9e6b3990466eb7dab7e376e779ebd7dbecb250417ea80bd8c2b6a, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', duration_ms: 0 }
        - { id: 1066, slug: refresh-reporting, config_name: staging, single_run: true, active_key: f955fcfb62e91cda12451f51c5619a315a3869f9de0ff24c6a75b04059d80dcb, status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', duration_ms: 0 }
    - from: db:pipeline_step
      label: pending step snapshot
      rows:
        - { pipeline_run_id: 1044, step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, needs: '[]', status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
        - { pipeline_run_id: 1062, step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, needs: '[]', status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
        - { pipeline_run_id: 1066, step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, needs: '[]', status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
        - { pipeline_run_id: 1066, step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, needs: '[1]', status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
        - { pipeline_run_id: 1066, step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, needs: '[2]', status: pending, transaction_outcome: pending, started_at: null, finished_at: null, error_message: '', skip_reason: '', duration_ms: 0 }
  out:
    - to: db:pipeline_run
      label: direct run outcomes
      rows:
        - { id: 1044, active_key: null, status: success, transaction_outcome: committed, started_at: '2026-01-12T10:00:00Z', finished_at: '2026-01-12T10:03:00Z', error_message: '', duration_ms: 180000 }
        - { id: 1054, active_key: null, status: unknown, transaction_outcome: unknown, started_at: '2026-01-22T10:00:00Z', finished_at: '2026-01-22T10:03:00Z', error_message: Transaction outcome unknown, duration_ms: 180000 }
        - { id: 1066, active_key: null, status: success, transaction_outcome: committed, started_at: '2026-02-06T10:00:00Z', finished_at: '2026-02-06T10:03:00Z', error_message: '', duration_ms: 180000 }
        - { id: 1068, active_key: null, status: failed, transaction_outcome: no_effects, started_at: null, finished_at: '2026-02-08T10:00:00Z', error_message: Workflow connection failed, duration_ms: 0 }
    - to: db:pipeline_step
      label: direct step outcomes
      rows:
        - { pipeline_run_id: 1044, step_no: 1, status: success, transaction_outcome: committed, started_at: '2026-01-12T10:00:00Z', finished_at: '2026-01-12T10:01:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1042, step_no: 2, status: failed, transaction_outcome: rolled_back, started_at: '2026-01-10T10:01:00Z', finished_at: '2026-01-10T10:02:00Z', error_message: Step execution failed, skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1066, step_no: 1, status: success, transaction_outcome: committed, started_at: '2026-02-06T10:00:00Z', finished_at: '2026-02-06T10:01:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1066, step_no: 2, status: success, transaction_outcome: committed, started_at: '2026-02-06T10:01:00Z', finished_at: '2026-02-06T10:02:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1066, step_no: 3, status: success, transaction_outcome: committed, started_at: '2026-02-06T10:02:00Z', finished_at: '2026-02-06T10:03:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1068, step_no: 1, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null, error_message: '', skip_reason: workflow connection failed, duration_ms: 0 }
    - to: ext:Caller
      label: success and audit error
      rows:
        - { run_id: 1044, slug: refresh-reporting, config_name: dev, status: success, transaction_outcome: committed, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: committed }], errors: [], result: 0 }
        - { run_id: 1062, slug: refresh-reporting, config_name: dev, status: unknown, transaction_outcome: unknown, errors: [Step execution failed, Rollback failed], result: 1 }
        - { run_id: 1042, slug: refresh-reporting, config_name: dev, status: failed, transaction_outcome: rolled_back, errors: [Step execution failed, Audit update failed], result: 1 }
---

Buffer [[pipeline_run]] and [[pipeline_step]] outcomes until workflow SQL and transaction activity settles, then atomically flush in a separate bookkeeping transaction on the caller's pool, against the same database. Owned workflow connections are disposed separately, not returned to the caller's pool. No generic history is involved. Execution and transaction outcomes remain distinct; lost acknowledgement or failed rollback remains unknown.

If activity is uncertain, do not flush an asserted terminal outcome or release ownership: run 1062's pending rows remain durable intent, even though SQL may already have executed. Its competing protected admission remains busy; this illustration does not assert whether business effects committed. By contrast, 1066 commits and settles before its key is cleared. Compare both run ID and `active_key` before clearing ownership, including audit-failure cleanup. Preserve primary execution and secondary audit or cleanup errors; failed required audit cannot report clean success. Normal responses exclude raw input and rendered SQL.

Run 1068 contrasts with uncertain activity: the owned pool failed before any dispatch, so activity is known quiescent and no workflow effects occurred. Persist the failed run and all skipped steps, compare the run ID and key, and release ownership so a fresh retry can be admitted.

There is no TTL, lease, automatic steal or force unlock. For recovery, stop and fence the worker, independently establish that its owned SQL and transactions have settled, and inspect the correct database. Session IDs are not recorded in history; correlate sessions using independent evidence, never blanket-kill. In one transaction lock and compare the exact run ID, config, slug and key; a mismatch must make no mutation. Preserve known terminal outcomes, mark unresolved outcomes unknown unless independently established, and clear the matching key only after quiescence. Pending intent is not proof that a step never started.
