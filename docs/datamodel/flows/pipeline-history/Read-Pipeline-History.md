---
process: Read Pipeline History
number: 1
description: Reads authorized pipeline history with authoritative run and step outcomes and generic audit summaries.
inputs:
  - from: ext:Caller
    label: history query
    data: slug or run_id selector, config_name, caller identity, limit for a slug query
  - from: cluster:pipeline-history
    label: recorded history
    data:
      change: [id, config_name, status, error_message]
      executions: [id, change_id, filepath, status, error_message, skip_reason]
      pipeline_run: [id, slug, manifest_checksum, transaction_policy, status, transaction_outcome, started_at, finished_at]
      pipeline_step: [pipeline_run_id, step_no, execution_id, name, status, transaction_outcome]
outputs:
  - to: ext:Caller
    label: history result
    data: result status, error when rejected or not found, ordered runs with run_id, slug, config_name, manifest_checksum, transaction_policy, pipeline status, transaction_outcome, started_at, finished_at, generic change status and error summary, and ordered steps with step_no, name, filepath, pipeline status, transaction_outcome, generic execution status, error summary and skip reason
examples:
  in:
    - from: ext:Caller
      label: history queries
      rows:
        - { slug: refresh-reporting, run_id: null, config_name: dev, identity: synthetic-operator, limit: 3 }
        - { slug: null, run_id: 1042, config_name: dev, identity: synthetic-operator, limit: null }
        - { slug: null, run_id: 1054, config_name: dev, identity: synthetic-operator, limit: null }
    - from: db:change
      label: generic run summaries
      rows:
        - { id: 1042, config_name: dev, status: failed, error_message: 'Pipeline did not complete successfully' }
        - { id: 1043, config_name: dev, status: failed, error_message: 'Pipeline did not complete successfully' }
        - { id: 1054, config_name: dev, status: failed, error_message: 'Transaction outcome unknown' }
    - from: db:executions
      label: generic step summaries
      rows:
        - { id: 8201, change_id: 1042, filepath: collect.sql, status: success, error_message: '', skip_reason: '' }
        - { id: 8202, change_id: 1042, filepath: summarize.sql, status: failed, error_message: 'Step execution failed', skip_reason: '' }
        - { id: 8203, change_id: 1042, filepath: publish.sql, status: skipped, error_message: '', skip_reason: 'prior step did not complete' }
        - { id: 8204, change_id: 1043, filepath: collect.sql, status: success, error_message: '', skip_reason: '' }
        - { id: 8205, change_id: 1043, filepath: summarize.sql, status: failed, error_message: 'Step execution failed', skip_reason: '' }
        - { id: 8206, change_id: 1043, filepath: publish.sql, status: skipped, error_message: '', skip_reason: 'prior step did not complete' }
        - { id: 8237, change_id: 1054, filepath: collect.sql, status: success, error_message: '', skip_reason: '' }
        - { id: 8238, change_id: 1054, filepath: summarize.sql, status: success, error_message: '', skip_reason: '' }
        - { id: 8239, change_id: 1054, filepath: publish.sql, status: success, error_message: '', skip_reason: '' }
    - from: db:pipeline_run
      label: authoritative run outcomes
      rows:
        - { id: 1042, slug: refresh-reporting, manifest_checksum: 'cccccccc', transaction_policy: pipeline, status: failed, transaction_outcome: rolled_back, started_at: '2026-01-10T10:00:00Z', finished_at: '2026-01-10T10:02:00Z' }
        - { id: 1043, slug: refresh-reporting, manifest_checksum: 'eeeeeeee', transaction_policy: step, status: partial, transaction_outcome: partial, started_at: '2026-01-11T10:00:00Z', finished_at: '2026-01-11T10:02:00Z' }
        - { id: 1054, slug: refresh-reporting, manifest_checksum: 'cccccccc', transaction_policy: pipeline, status: unknown, transaction_outcome: unknown, started_at: '2026-01-22T10:00:00Z', finished_at: '2026-01-22T10:03:00Z' }
    - from: db:pipeline_step
      label: authoritative step outcomes
      rows:
        - { pipeline_run_id: 1042, step_no: 1, execution_id: 8201, name: collect, status: success, transaction_outcome: rolled_back }
        - { pipeline_run_id: 1042, step_no: 2, execution_id: 8202, name: summarize, status: failed, transaction_outcome: rolled_back }
        - { pipeline_run_id: 1042, step_no: 3, execution_id: 8203, name: publish, status: skipped, transaction_outcome: not_started }
        - { pipeline_run_id: 1043, step_no: 1, execution_id: 8204, name: collect, status: success, transaction_outcome: committed }
        - { pipeline_run_id: 1043, step_no: 2, execution_id: 8205, name: summarize, status: failed, transaction_outcome: rolled_back }
        - { pipeline_run_id: 1043, step_no: 3, execution_id: 8206, name: publish, status: skipped, transaction_outcome: not_started }
        - { pipeline_run_id: 1054, step_no: 1, execution_id: 8237, name: collect, status: success, transaction_outcome: unknown }
        - { pipeline_run_id: 1054, step_no: 2, execution_id: 8238, name: summarize, status: success, transaction_outcome: unknown }
        - { pipeline_run_id: 1054, step_no: 3, execution_id: 8239, name: publish, status: success, transaction_outcome: unknown }
  out:
    - to: ext:Caller
      label: ordered history
      rows:
        - result_status: ok
          error: null
          runs:
            - run_id: 1054
              slug: refresh-reporting
              config_name: dev
              manifest_checksum: 'cccccccc'
              transaction_policy: pipeline
              pipeline_status: unknown
              transaction_outcome: unknown
              started_at: '2026-01-22T10:00:00Z'
              finished_at: '2026-01-22T10:03:00Z'
              generic_change_status: failed
              generic_error_summary: Transaction outcome unknown
              steps:
                - { step_no: 1, name: collect, filepath: collect.sql, pipeline_status: success, transaction_outcome: unknown, generic_execution_status: success, error_summary: '', skip_reason: '' }
                - { step_no: 2, name: summarize, filepath: summarize.sql, pipeline_status: success, transaction_outcome: unknown, generic_execution_status: success, error_summary: '', skip_reason: '' }
                - { step_no: 3, name: publish, filepath: publish.sql, pipeline_status: success, transaction_outcome: unknown, generic_execution_status: success, error_summary: '', skip_reason: '' }
            - run_id: 1043
              slug: refresh-reporting
              config_name: dev
              manifest_checksum: 'eeeeeeee'
              transaction_policy: step
              pipeline_status: partial
              transaction_outcome: partial
              started_at: '2026-01-11T10:00:00Z'
              finished_at: '2026-01-11T10:02:00Z'
              generic_change_status: failed
              generic_error_summary: Pipeline did not complete successfully
              steps:
                - { step_no: 1, name: collect, filepath: collect.sql, pipeline_status: success, transaction_outcome: committed, generic_execution_status: success, error_summary: '', skip_reason: '' }
                - { step_no: 2, name: summarize, filepath: summarize.sql, pipeline_status: failed, transaction_outcome: rolled_back, generic_execution_status: failed, error_summary: Step execution failed, skip_reason: '' }
                - { step_no: 3, name: publish, filepath: publish.sql, pipeline_status: skipped, transaction_outcome: not_started, generic_execution_status: skipped, error_summary: '', skip_reason: prior step did not complete }
            - run_id: 1042
              slug: refresh-reporting
              config_name: dev
              manifest_checksum: 'cccccccc'
              transaction_policy: pipeline
              pipeline_status: failed
              transaction_outcome: rolled_back
              started_at: '2026-01-10T10:00:00Z'
              finished_at: '2026-01-10T10:02:00Z'
              generic_change_status: failed
              generic_error_summary: Pipeline did not complete successfully
              steps:
                - { step_no: 1, name: collect, filepath: collect.sql, pipeline_status: success, transaction_outcome: rolled_back, generic_execution_status: success, error_summary: '', skip_reason: '' }
                - { step_no: 2, name: summarize, filepath: summarize.sql, pipeline_status: failed, transaction_outcome: rolled_back, generic_execution_status: failed, error_summary: Step execution failed, skip_reason: '' }
                - { step_no: 3, name: publish, filepath: publish.sql, pipeline_status: skipped, transaction_outcome: not_started, generic_execution_status: skipped, error_summary: '', skip_reason: prior step did not complete }
        - { result_status: unauthorized, error: 'History access denied', runs: [] }
        - { result_status: not_found, error: 'Pipeline history not found', runs: [] }
---

This proposed read API accepts a [[Caller]]'s slug or run ID, selected configuration and identity, and a limit for slug queries. It authorizes access before returning records; unauthorized and not-found results go back to the caller without a mutation. No shipping CLI command is implied.

It joins [[pipeline_run]] to its shared [[change]] identity, then joins ordered [[pipeline_step]] entries to their [[executions]] audit rows. Slug results are ordered newest first by run ID, with a limit; steps are ordered by `step_no`. The pipeline statuses and transaction outcomes are authoritative; the generic change and execution statuses are coarse summaries, not competing proof of commit. A pending or incomplete audit snapshot cannot establish commit or rollback, and unknown remains unknown. The query takes no execution lock and performs no writes. It returns sanitized summaries, never secrets or raw SQL.

Examples are synthetic model snapshots, not production records. The first output is a representative limited selection of the three displayed runs, not a claim that other modeled runs do not exist. Checksums are abbreviated to eight characters.
