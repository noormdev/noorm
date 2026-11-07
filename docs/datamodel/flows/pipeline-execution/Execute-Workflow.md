---
process: Execute Workflow
number: 3
description: Schedule prepared linear or graph steps under their transaction policy and capture observed outcomes.
inputs:
  - from: cache:active-runs
    label: reserved run
    data: run_id, slug, config_name, executed_by, cli_version, transaction_policy, manifest_checksum, single_run, guard ownership if protected, order_mode, concurrency cap, declared steps with step_no, name, filepath, rendered checksum, prepared SQL and needs when graph
  - from: ext:DatabaseEngine
    label: workflow results
    data: run_id and step_no correlation, session and transaction boundary, SQL result or error, statement timing, commit or rollback acknowledgement or connection error
outputs:
  - to: ext:DatabaseEngine
    label: workflow commands
    data: run_id, config_name, transaction_policy, order_mode, effective concurrency cap, session affinity and transaction boundaries, scheduled step_no, name and prepared SQL
  - to: cache:execution-outcomes
    label: execution outcome
    data: run_id, slug, config_name, single_run, guard ownership if protected, confirmation that workflow SQL and transaction activity have settled before release, status, transaction_outcome, started_at, finished_at, duration_ms, error_message, declared step results with step_no, name, status, transaction_outcome, started_at, finished_at, duration_ms, error_message and skip_reason, errors
examples:
  in:
    - from: cache:active-runs
      label: linear workflow
      rows:
        - { run_id: 1042, slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', transaction_policy: pipeline, manifest_checksum: cccccccc, single_run: false, order_mode: linear, concurrency_cap: 1, steps: [{ step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, sql: 'SELECT 1' }, { step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, sql: 'SELECT 2' }, { step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, sql: 'SELECT 3' }] }
    - from: ext:DatabaseEngine
      label: observed outcomes
      rows:
        - { run_id: 1042, session: pinned, events: [{ step_no: 1, command: execute, result: success, started_at: '2026-01-10T10:00:00Z', finished_at: '2026-01-10T10:01:00Z' }, { step_no: 2, command: execute, error: Step execution failed, started_at: '2026-01-10T10:01:00Z', finished_at: '2026-01-10T10:02:00Z' }, { command: rollback, acknowledgement: confirmed }] }
        - { run_id: 1054, session: pinned, events: [{ command: commit, acknowledgement: absent, error: Connection lost before commit acknowledgement }] }
  out:
    - to: ext:DatabaseEngine
      label: serial and parallel scheduling
      rows:
        - { run_id: 1063, config_name: dev, transaction_policy: pipeline, order_mode: graph, concurrency_cap: 1, session: one pinned transaction, schedule: [stage-api, clean-accounts, clean-invoices, aggregate], needs: { stage-api: [], clean-accounts: [stage-api], clean-invoices: [stage-api], aggregate: [clean-accounts, clean-invoices] }, sql: prepared step SQL }
        - { run_id: 1064, config_name: dev, transaction_policy: step, order_mode: graph, concurrency_cap: 2, session: one transaction per step, schedule: [stage-api, 'clean-accounts and clean-invoices concurrently'], sql: prepared step SQL }
    - to: cache:execution-outcomes
      label: failure outcomes
      rows:
        - { run_id: 1042, slug: refresh-reporting, config_name: dev, single_run: false, status: failed, transaction_outcome: rolled_back, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: rolled_back }, { step_no: 2, name: summarize, status: failed, transaction_outcome: rolled_back, error_message: Step execution failed }, { step_no: 3, name: publish, status: skipped, transaction_outcome: not_started, skip_reason: prior step did not complete }], errors: [Step execution failed] }
        - { run_id: 1064, slug: load-erp, config_name: dev, single_run: false, status: partial, transaction_outcome: partial, steps: [{ step_no: 1, name: stage-api, status: success, transaction_outcome: committed }, { step_no: 2, name: clean-accounts, status: failed, transaction_outcome: rolled_back }, { step_no: 3, name: clean-invoices, status: success, transaction_outcome: committed }, { step_no: 4, name: aggregate, status: skipped, transaction_outcome: not_started }], errors: [Account cleaning failed] }
---

Send prepared SQL to [[DatabaseEngine]] on the selected database. Linear mode executes in declaration order. Graph mode schedules only eligible dependencies: `pipeline` accepts the graph but serializes it on one pinned session in one transaction; `step` and `none` may run ready branches concurrently within the configured cap and pool size, each on its own transaction or pinned session respectively. Linear `none` also uses one pinned session; `step` does not promise reuse. Shared session-local state is available only under `pipeline` or linear `none`, subject to database rules. SQLite write concurrency is effectively one. The database returns SQL results and transaction acknowledgements; orchestration derives workflow statuses and marks unstarted steps skipped.

On first failure or interruption stop scheduling, let all active steps settle, then mark all unstarted steps skipped. Committed effects may yield `partial` under `step` or `none`. Do not imply cancellation of an active statement. Every invocation starts fresh; checksums never suppress execution or resume. Buffer audit during workflow transactions and persist separately at resolved boundaries; preserve unknown commit or rollback and original errors. Abbreviated examples omit timing and other fields present in the full contracts.

The executor supplies settlement evidence for protected finalization. Unknown transaction outcome and unknown active SQL are distinct: a lost acknowledgement alone cannot establish that database activity has ended. If activity cannot be shown to have settled, hand off that uncertainty without authorizing guard release.
