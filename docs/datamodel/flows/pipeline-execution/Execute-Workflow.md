---
process: Execute Workflow
number: 3
description: Execute prepared steps in order under the selected transaction policy and capture the observed outcome.
inputs:
  - from: cache:active-runs
    label: reserved run
    data: run_id, slug, config_name, executed_by, transaction_policy, ordered steps with step_no, name, path, sql_checksum and prepared SQL
  - from: ext:DatabaseEngine
    label: workflow results
    data: run_id, ordered step results with step_no, name, status, transaction_outcome, started_at and finished_at, errors, transaction_outcome
outputs:
  - to: ext:DatabaseEngine
    label: workflow commands
    data: run_id, transaction_policy, ordered prepared steps with step_no, name and SQL
  - to: cache:execution-outcomes
    label: execution outcome
    data: run_id, config_name, status, transaction_outcome, ordered steps with step_no, name, status, transaction_outcome, started_at and finished_at, errors
examples:
  in:
    - from: cache:active-runs
      label: pipeline and step policies
      rows:
        - { run_id: 1042, slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, transaction_policy: pipeline, steps: [{ step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 1' }, { step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 2' }, { step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 3' }] }
        - { run_id: 1043, slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, transaction_policy: step, steps: [{ step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 1' }, { step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 2' }, { step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 3' }] }
    - from: ext:DatabaseEngine
      label: observed transaction outcomes
      rows:
        - { run_id: 1042, transaction_outcome: rolled_back, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: rolled_back }, { step_no: 2, name: summarize, status: failed, transaction_outcome: rolled_back }, { step_no: 3, name: publish, status: skipped, transaction_outcome: not_started }], errors: ['Step execution failed'] }
        - { run_id: 1054, transaction_outcome: unknown, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: unknown }, { step_no: 2, name: summarize, status: success, transaction_outcome: unknown }, { step_no: 3, name: publish, status: success, transaction_outcome: unknown }], errors: ['Commit acknowledgement lost'] }
  out:
    - to: ext:DatabaseEngine
      label: ordered prepared SQL
      rows:
        - { run_id: 1042, transaction_policy: pipeline, steps: [{ step_no: 1, name: collect, sql: 'SELECT 1' }, { step_no: 2, name: summarize, sql: 'SELECT 2' }, { step_no: 3, name: publish, sql: 'SELECT 3' }] }
        - { run_id: 1043, transaction_policy: step, steps: [{ step_no: 1, name: collect, sql: 'SELECT 1' }, { step_no: 2, name: summarize, sql: 'SELECT 2' }, { step_no: 3, name: publish, sql: 'SELECT 3' }] }
    - to: cache:execution-outcomes
      label: rollback and partial outcomes
      rows:
        - { run_id: 1042, config_name: dev, status: failed, transaction_outcome: rolled_back, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: rolled_back }, { step_no: 2, name: summarize, status: failed, transaction_outcome: rolled_back }, { step_no: 3, name: publish, status: skipped, transaction_outcome: not_started }], errors: ['Step execution failed'] }
        - { run_id: 1043, config_name: dev, status: partial, transaction_outcome: partial, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: committed }, { step_no: 2, name: summarize, status: failed, transaction_outcome: rolled_back }, { step_no: 3, name: publish, status: skipped, transaction_outcome: not_started }], errors: ['Step execution failed'] }
        - { run_id: 1054, config_name: dev, status: unknown, transaction_outcome: unknown, steps: [{ step_no: 1, name: collect, status: success, transaction_outcome: unknown }, { step_no: 2, name: summarize, status: success, transaction_outcome: unknown }, { step_no: 3, name: publish, status: success, transaction_outcome: unknown }], errors: ['Commit acknowledgement lost'] }
---

Send prepared SQL to [[DatabaseEngine]], the same resolved database that is the application SQL target, not a separate cross-database target. `pipeline` wraps the complete workflow in one transaction; `step` uses one transaction per step, so earlier commits can survive a later rollback; `none` adds no wrapping transaction, so independently committed effects can survive failure and no-effects is not called rollback. Execute in manifest order and stop on the first failure or interruption. Mark unreached steps skipped and never execute later steps after interruption. Every invocation is fresh: checksums record inputs, never suppress unchanged steps or resume a prior run.

Buffer step audit while a workflow transaction is open, then hand the observed outcome to [[execution-outcomes]] for a separate bookkeeping transaction. Do not infer a successful commit or rollback when an acknowledgement is lost or rollback fails: report `unknown` and preserve errors. The cache is ephemeral, not a table or checkpoint. The sample SQL is synthetic and checksums abbreviated to eight characters; timestamps omitted in abbreviated result examples are still part of the complete edge contracts.
