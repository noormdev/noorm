---
process: Execute Workflow
number: 3
description: Schedule prepared linear or graph steps under their transaction policy and capture observed outcomes.
inputs:
  - from: cache:active-runs
    label: reserved run
    data: run_id, slug, config_name, executed_by, cli_version, transaction_policy, manifest_checksum, single_run, active_key, order_mode, concurrency cap, immutable resolved input, declared steps with step_no, name, filepath, rendered checksum, prepared SQL and numeric needs
  - from: ext:DatabaseEngine
    label: workflow results
    data: run_id and step_no correlation, session and transaction boundary, SQL result or error, statement timing, commit or rollback acknowledgement or connection error
outputs:
  - to: ext:DatabaseEngine
    label: workflow commands
    data: run_id, config_name, transaction_policy, order_mode, effective concurrency cap, session affinity and transaction boundaries, scheduled step_no, name and prepared SQL
  - to: cache:execution-outcomes
    label: execution outcome
    data: run_id, slug, config_name, single_run, active_key, workflow_settled, status, transaction_outcome, started_at, finished_at, duration_ms, error_message, declared step results with step_no, name, status, transaction_outcome, started_at, finished_at, duration_ms, error_message and skip_reason, primary and secondary errors
examples:
  in:
    - from: cache:active-runs
      label: linear workflow
      rows:
        - { run_id: 1042, slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', transaction_policy: pipeline, manifest_checksum: cccccccc, single_run: false, active_key: null, order_mode: linear, concurrency_cap: 1, input: { region: east }, steps: [{ step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, sql: 'SELECT 1', needs: [] }, { step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, sql: 'SELECT 2', needs: [1] }, { step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, sql: 'SELECT 3', needs: [2] }] }
    - from: ext:DatabaseEngine
      label: observed outcomes
      rows:
        - { run_id: 1042, session: pinned, events: [{ step_no: 1, command: execute, result: success, started_at: '2026-01-10T10:00:00Z', finished_at: '2026-01-10T10:01:00Z' }, { step_no: 2, command: execute, error: Step execution failed, started_at: '2026-01-10T10:01:00Z', finished_at: '2026-01-10T10:02:00Z' }, { command: rollback, acknowledgement: confirmed }] }
        - { run_id: 1054, session: pinned, events: [{ command: commit, acknowledgement: absent, error: Connection lost before commit acknowledgement }] }
        - { run_id: 1062, session: invocation-owned, events: [{ step_no: 1, command: execute, result: success }, { step_no: 2, command: execute, error: Step execution failed }, { command: rollback, error: Rollback acknowledgement unavailable }] }
        - { run_id: 1067, session: pinned, events: [{ step_no: 1, command: 'BEGIN; INSERT', result: success }, { step_no: 2, command: execute, error: Step execution failed }, { command: close, result: uncommitted insert rolled back }] }
        - { run_id: 1068, session: invocation-owned, events: [{ command: open workflow pool, error: Workflow connection failed, workflow_dispatched: false }] }
  out:
    - to: ext:DatabaseEngine
      label: serial and parallel scheduling
      rows:
        - { run_id: 1063, config_name: dev, transaction_policy: pipeline, order_mode: graph, concurrency_cap: 1, session: one pinned transaction, schedule: [stage-api, clean-accounts, clean-invoices, aggregate], needs: { 1: [], 2: [1], 3: [1], 4: [2, 3] }, sql: prepared step SQL }
        - { run_id: 1064, config_name: dev, transaction_policy: step, order_mode: graph, concurrency_cap: 2, session: one transaction per step, schedule: [stage-api, 'clean-accounts and clean-invoices concurrently'], needs: { 1: [], 2: [1], 3: [1], 4: [2, 3] }, sql: prepared step SQL }
    - to: cache:execution-outcomes
      label: failure outcomes
      rows:
        - { run_id: 1042, slug: refresh-reporting, config_name: dev, single_run: false, active_key: null, workflow_settled: true, status: failed, transaction_outcome: rolled_back, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: rolled_back }, { step_no: 2, name: summarize, status: failed, transaction_outcome: rolled_back, error_message: Step execution failed }, { step_no: 3, name: publish, status: skipped, transaction_outcome: not_started, skip_reason: prior step did not complete }], errors: [Step execution failed] }
        - { run_id: 1064, slug: load-erp, config_name: dev, single_run: false, active_key: null, workflow_settled: true, status: partial, transaction_outcome: partial, steps: [{ step_no: 1, name: stage-api, status: success, transaction_outcome: committed }, { step_no: 2, name: clean-accounts, status: failed, transaction_outcome: rolled_back }, { step_no: 3, name: clean-invoices, status: success, transaction_outcome: committed }, { step_no: 4, name: aggregate, status: skipped, transaction_outcome: not_started }], errors: [Account cleaning failed] }
        - { run_id: 1062, slug: refresh-reporting, config_name: dev, single_run: true, active_key: 7dceed79baa9e6b3990466eb7dab7e376e779ebd7dbecb250417ea80bd8c2b6a, workflow_settled: false, status: unknown, transaction_outcome: unknown, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: unknown }, { step_no: 2, name: summarize, status: failed, transaction_outcome: unknown }, { step_no: 3, name: publish, status: skipped, transaction_outcome: not_started }], errors: [Step execution failed, Rollback failed] }
        - { run_id: 1067, slug: manual-load, config_name: dev, single_run: false, active_key: null, workflow_settled: true, status: unknown, transaction_outcome: unknown, steps: [{ step_no: 1, name: insert-manual, status: success, transaction_outcome: unknown }, { step_no: 2, name: missing-table, status: failed, transaction_outcome: unknown }], errors: [Step execution failed] }
        - { run_id: 1068, slug: refresh-reporting, config_name: staging, single_run: true, active_key: f955fcfb62e91cda12451f51c5619a315a3869f9de0ff24c6a75b04059d80dcb, workflow_settled: true, status: failed, transaction_outcome: no_effects, steps: [{ step_no: 1, name: collect, status: skipped, transaction_outcome: not_started }, { step_no: 2, name: summarize, status: skipped, transaction_outcome: not_started }, { step_no: 3, name: publish, status: skipped, transaction_outcome: not_started }], errors: [Workflow connection failed] }
---

Send only prepared SQL, not input metadata, to [[DatabaseEngine]]. Rendering is already complete and cannot depend on earlier workflow mutations. Linear mode follows declaration order. Graph mode schedules eligible numeric prerequisites, lowest declaration number first. `pipeline` serializes on one pinned transaction; graph `step` and `none` use separate pinned connections with concurrency `max(1, min(manifest concurrency, pool.max ?? 10))`. Linear mode, pipeline transactions and SQLite use concurrency one. Linear `none` pins one session; graph `none` and `step` do not inherit session state across steps.

Except for in-memory SQLite, each invocation owns a separate workflow pool to the same database, capped at the effective concurrency with minimum zero; caller plugins are preserved. History uses the caller's separate pool, not a second database. On uncertain transaction cleanup stop scheduling before a potentially contaminated workflow connection can be reused; dispose the owned pool after active work returns. Pool disposal failure does not prove quiescence. Never destroy the caller pool for this case.

An in-memory SQLite database instead shares its original connection, because another connection would be a different database. If its transaction cannot be made safe, close and invalidate that connection and its owner while the lease is still held, before it could be reused; the in-memory database is lost and the SDK must reconnect. Ordinary settled memory executions retain the connection.

Under `none`, recognize direct author transaction or autocommit changes without rejecting them or adding a managed boundary. SQL success does not prove affected work committed; use unknown provenance for affected and subsequent work, preserve independently confirmed earlier autocommits, and do not manufacture a partial failure when all execution succeeds. The bounded recognizer cannot see controls hidden in routines or dynamic SQL. Settle or invalidate the session safely before reuse, including shared in-memory SQLite.

If an owned workflow pool cannot open before any workflow SQL or boundary is dispatched, no workflow activity is possible: report settled, `no_effects` and skipped steps so finalization can persist the failure and release the protected key. This is distinct from uncertain activity after dispatch.

On first failure or interruption stop scheduling, let all active SQL and transaction activity settle, then mark unstarted steps skipped. Do not imply cancellation of an active statement. Every invocation starts fresh; checksums never suppress execution or resume. Buffer audit until all workflow activity quiesces, then flush separately; preserve unknown commit or rollback and primary and secondary errors.

The executor supplies `workflow_settled` evidence for protected finalization. Unknown transaction outcome and unknown active SQL are distinct: a lost acknowledgement alone does not establish ongoing activity. If activity cannot be shown to have settled, retain the run's active key. In synthetic run 1062 a failed rollback leaves the outcome and activity uncertain; it does not assert a business commit. Examples are illustrative and abbreviate timing and other fields.
