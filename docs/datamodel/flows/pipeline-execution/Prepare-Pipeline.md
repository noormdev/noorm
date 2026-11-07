---
process: Prepare Pipeline
number: 1
description: Validate and prepare a fresh invocation or return a preview or rejection without creating history.
inputs:
  - from: ext:Caller
    label: invocation request
    data: slug, config_name, executed_by identity, resolved identity and configuration policy context, dry_run
  - from: file:pipeline-definitions
    label: pipeline definition
    data: slug, manifest_checksum, transaction_policy, ordered steps with step_no, name, path and sql_checksum
outputs:
  - to: ext:Caller
    label: preview or rejection
    data: slug, config_name, dry_run, status, ordered step numbers and names for preview, errors for rejection
  - to: cache:prepared-invocations
    label: prepared invocation
    data: slug, config_name, executed_by, transaction_policy, manifest_checksum, ordered steps with step_no, name, path, sql_checksum and prepared SQL, dry_run=false
examples:
  in:
    - from: ext:Caller
      label: real invocation and preview
      rows:
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, policy_context: allowed, dry_run: false }
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, policy_context: allowed, dry_run: true }
    - from: file:pipeline-definitions
      label: two manifest policies
      rows:
        - { slug: refresh-reporting, manifest_checksum: cccccccc, transaction_policy: pipeline, steps: [{ step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb }, { step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb }, { step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb }] }
        - { slug: refresh-reporting, manifest_checksum: eeeeeeee, transaction_policy: step, steps: [{ step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb }, { step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb }, { step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb }] }
  out:
    - to: ext:Caller
      label: preview and rejected request
      rows:
        - { slug: refresh-reporting, config_name: dev, dry_run: true, status: preview, steps: [{ step_no: 1, name: collect }, { step_no: 2, name: summarize }, { step_no: 3, name: publish }], errors: [] }
        - { slug: refresh-reporting, config_name: dev, dry_run: false, status: rejected, steps: [], errors: [policy denied] }
    - to: cache:prepared-invocations
      label: validated invocation
      rows:
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, transaction_policy: pipeline, manifest_checksum: cccccccc, dry_run: false, steps: [{ step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 1' }, { step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 2' }, { step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb, sql: 'SELECT 3' }] }
---

Prepare a fresh invocation from the caller's request and [[pipeline-definitions]]. Validate the manifest, ordered step identities and referenced files, and check the configured policy using the already resolved request context **before rendering** SQL. This diagram does not introduce a vault or identity database read. Prepared SQL is sensitive transient material; the illustrative SQL is synthetic and the eight-character checksums throughout the examples are abbreviations.

A dry run returns a preview, while preflight or policy failure returns a rejection. Neither acquires a lock nor creates a run or any history. Only a validated real invocation enters [[prepared-invocations]], an ephemeral in-memory handoff, not a table or resume checkpoint. Normal caller responses do not expose rendered SQL or secrets.

The process numbers identify diagram processes, not manifest step identities. The DFD describes data movement and possible outcomes, not a control-flow or completion guarantee.
