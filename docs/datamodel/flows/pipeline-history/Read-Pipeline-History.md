---
process: Read Pipeline History
number: 1
description: Read authorized independent pipeline run and step evidence.
inputs:
  - from: ext:Caller
    label: history query
    data: slug or run_id selector, config_name, caller identity, limit for a slug query
  - from: cluster:pipeline-history
    label: recorded history
    data:
      pipeline_run: [id, slug, config_name, executed_by, cli_version, created_at, manifest_checksum, transaction_policy, single_run, active_key, status, transaction_outcome, started_at, finished_at, error_message, duration_ms]
      pipeline_step: [pipeline_run_id, step_no, name, filepath, checksum, needs, status, transaction_outcome, started_at, finished_at, error_message, skip_reason, duration_ms]
outputs:
  - to: ext:Caller
    label: history result
    data: result status and error, runs with run_id, slug, config_name, executed_by, cli_version, created_at, manifest_checksum, transaction_policy, single_run, active_key, status, transaction_outcome, started_at, finished_at, error_message, duration_ms, steps ordered by step_no with name, filepath, checksum, needs, status, transaction_outcome, started_at, finished_at, error_message, skip_reason and duration_ms
examples:
  in:
    - from: ext:Caller
      label: history queries
      rows:
        - { slug: refresh-reporting, run_id: null, config_name: dev, identity: synthetic-operator, limit: 3 }
        - { slug: null, run_id: 1042, config_name: dev, identity: synthetic-operator, limit: null }
        - { slug: null, run_id: 1054, config_name: dev, identity: synthetic-operator, limit: null }
    - from: db:pipeline_run
      label: direct run outcomes
      rows:
        - { id: 1042, slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', created_at: '2026-01-10T10:00:00Z', manifest_checksum: cccccccc, transaction_policy: pipeline, single_run: false, active_key: null, status: failed, transaction_outcome: rolled_back, started_at: '2026-01-10T10:00:00Z', finished_at: '2026-01-10T10:02:00Z', error_message: Pipeline did not complete successfully, duration_ms: 120000 }
        - { id: 1043, slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', created_at: '2026-01-11T10:00:00Z', manifest_checksum: eeeeeeee, transaction_policy: step, single_run: false, active_key: null, status: partial, transaction_outcome: partial, started_at: '2026-01-11T10:00:00Z', finished_at: '2026-01-11T10:02:00Z', error_message: Pipeline did not complete successfully, duration_ms: 120000 }
        - { id: 1054, slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', created_at: '2026-01-22T10:00:00Z', manifest_checksum: cccccccc, transaction_policy: pipeline, single_run: false, active_key: null, status: unknown, transaction_outcome: unknown, started_at: '2026-01-22T10:00:00Z', finished_at: '2026-01-22T10:03:00Z', error_message: Transaction outcome unknown, duration_ms: 180000 }
    - from: db:pipeline_step
      label: direct step outcomes
      rows:
        - { pipeline_run_id: 1042, step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, needs: '[]', status: success, transaction_outcome: rolled_back, started_at: '2026-01-10T10:00:00Z', finished_at: '2026-01-10T10:01:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1042, step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, needs: '[1]', status: failed, transaction_outcome: rolled_back, started_at: '2026-01-10T10:01:00Z', finished_at: '2026-01-10T10:02:00Z', error_message: Step execution failed, skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1042, step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, needs: '[2]', status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null, error_message: '', skip_reason: prior step did not complete, duration_ms: 0 }
        - { pipeline_run_id: 1043, step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, needs: '[]', status: success, transaction_outcome: committed, started_at: '2026-01-11T10:00:00Z', finished_at: '2026-01-11T10:01:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1043, step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, needs: '[1]', status: failed, transaction_outcome: rolled_back, started_at: '2026-01-11T10:01:00Z', finished_at: '2026-01-11T10:02:00Z', error_message: Step execution failed, skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1043, step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, needs: '[2]', status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null, error_message: '', skip_reason: prior step did not complete, duration_ms: 0 }
        - { pipeline_run_id: 1054, step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, needs: '[]', status: success, transaction_outcome: unknown, started_at: '2026-01-22T10:00:00Z', finished_at: '2026-01-22T10:01:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1054, step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, needs: '[1]', status: success, transaction_outcome: unknown, started_at: '2026-01-22T10:01:00Z', finished_at: '2026-01-22T10:02:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
        - { pipeline_run_id: 1054, step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, needs: '[2]', status: success, transaction_outcome: unknown, started_at: '2026-01-22T10:02:00Z', finished_at: '2026-01-22T10:03:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
  out:
    - to: ext:Caller
      label: authorized history
      rows:
        - result_status: ok
          error: null
          runs:
            - run_id: 1054
              slug: refresh-reporting
              config_name: dev
              executed_by: synthetic-operator
              cli_version: '1.0.0'
              created_at: '2026-01-22T10:00:00Z'
              manifest_checksum: cccccccc
              transaction_policy: pipeline
              single_run: false
              active_key: null
              status: unknown
              transaction_outcome: unknown
              started_at: '2026-01-22T10:00:00Z'
              finished_at: '2026-01-22T10:03:00Z'
              error_message: Transaction outcome unknown
              duration_ms: 180000
              steps:
                - { step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, needs: '[]', status: success, transaction_outcome: unknown, started_at: '2026-01-22T10:00:00Z', finished_at: '2026-01-22T10:01:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
                - { step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, needs: '[1]', status: success, transaction_outcome: unknown, started_at: '2026-01-22T10:01:00Z', finished_at: '2026-01-22T10:02:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
                - { step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, needs: '[2]', status: success, transaction_outcome: unknown, started_at: '2026-01-22T10:02:00Z', finished_at: '2026-01-22T10:03:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
            - run_id: 1043
              slug: refresh-reporting
              config_name: dev
              executed_by: synthetic-operator
              cli_version: '1.0.0'
              created_at: '2026-01-11T10:00:00Z'
              manifest_checksum: eeeeeeee
              transaction_policy: step
              single_run: false
              active_key: null
              status: partial
              transaction_outcome: partial
              started_at: '2026-01-11T10:00:00Z'
              finished_at: '2026-01-11T10:02:00Z'
              error_message: Pipeline did not complete successfully
              duration_ms: 120000
              steps:
                - { step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, needs: '[]', status: success, transaction_outcome: committed, started_at: '2026-01-11T10:00:00Z', finished_at: '2026-01-11T10:01:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
                - { step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, needs: '[1]', status: failed, transaction_outcome: rolled_back, started_at: '2026-01-11T10:01:00Z', finished_at: '2026-01-11T10:02:00Z', error_message: Step execution failed, skip_reason: '', duration_ms: 60000 }
                - { step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, needs: '[2]', status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null, error_message: '', skip_reason: prior step did not complete, duration_ms: 0 }
            - run_id: 1042
              slug: refresh-reporting
              config_name: dev
              executed_by: synthetic-operator
              cli_version: '1.0.0'
              created_at: '2026-01-10T10:00:00Z'
              manifest_checksum: cccccccc
              transaction_policy: pipeline
              single_run: false
              active_key: null
              status: failed
              transaction_outcome: rolled_back
              started_at: '2026-01-10T10:00:00Z'
              finished_at: '2026-01-10T10:02:00Z'
              error_message: Pipeline did not complete successfully
              duration_ms: 120000
              steps:
                - { step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, needs: '[]', status: success, transaction_outcome: rolled_back, started_at: '2026-01-10T10:00:00Z', finished_at: '2026-01-10T10:01:00Z', error_message: '', skip_reason: '', duration_ms: 60000 }
                - { step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, needs: '[1]', status: failed, transaction_outcome: rolled_back, started_at: '2026-01-10T10:01:00Z', finished_at: '2026-01-10T10:02:00Z', error_message: Step execution failed, skip_reason: '', duration_ms: 60000 }
                - { step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, needs: '[2]', status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null, error_message: '', skip_reason: prior step did not complete, duration_ms: 0 }
        - { result_status: unauthorized, error: History access denied, runs: [] }
        - { result_status: not_found, error: Pipeline history not found, runs: [] }
---

Authorize the [[Caller]] and scope every [[pipeline_run]] and [[pipeline_step]] read to the resolved config. Slug history defaults to 20, accepts only integer limits 1 through 100, and orders by run ID descending. Run IDs must be positive safe integers; a foreign-config run returns null. Steps are in declaration order, not necessarily execution order. `active_key` exposes ownership state and `needs` is the persisted JSON array of numeric prerequisites. History is buffered until workflow activity settles, so pending rows can describe intent after SQL has started; they prove neither that a step was unstarted nor commit or rollback. Unknown remains unknown. No session IDs are stored for recovery. Results never expose raw input or rendered SQL.

These synthetic query/result snapshots reuse the entity examples and include every projected field and every intended step of each selected run. Checksums show eight characters for readability.
