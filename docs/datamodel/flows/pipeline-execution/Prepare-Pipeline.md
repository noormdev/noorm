---
process: Prepare Pipeline
number: 1
description: Validate and prepare a fresh invocation or return a preview or rejection without creating history.
inputs:
  - from: ext:Caller
    label: invocation request
    data: slug, config_name, executed_by, cli_version, resolved identity and policy context, single_run choice, dry_run
  - from: file:pipeline-definitions
    label: pipeline definition
    data: slug, manifest bytes and checksum, transaction policy, declared steps with name, SQL filepath and optional needs, local CSV JSON YAML and template inputs
outputs:
  - to: ext:Caller
    label: preview or rejection
    data: slug, config_name, dry_run, status, order mode, declared step numbers and names, errors
  - to: cache:prepared-invocations
    label: prepared invocation
    data: slug, config_name, executed_by, cli_version, transaction_policy, manifest_checksum, single_run, order_mode, concurrency cap, declared steps with step_no, name, filepath, rendered checksum, prepared SQL and needs when graph, dry_run=false
examples:
  in:
    - from: ext:Caller
      label: invocation and preview
      rows:
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', policy_context: allowed, single_run: false, dry_run: false }
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', policy_context: allowed, single_run: false, dry_run: true }
    - from: file:pipeline-definitions
      label: linear and diamond manifests
      rows:
        - { slug: refresh-reporting, manifest_checksum: cccccccc, transaction_policy: pipeline, steps: [{ name: collect, filepath: collect.sql }, { name: summarize, filepath: summarize.sql }, { name: publish, filepath: publish.sql }] }
        - { slug: load-erp, manifest_checksum: 1234abcd, transaction_policy: pipeline, steps: [{ name: stage-api, filepath: stage-api.sql, needs: [] }, { name: clean-accounts, filepath: clean-accounts.sql, needs: [stage-api] }, { name: clean-invoices, filepath: clean-invoices.sql, needs: [stage-api] }, { name: aggregate, filepath: aggregate.sql, needs: [clean-accounts, clean-invoices] }] }
        - { slug: load-local, manifest_checksum: 3456abcd, transaction_policy: step, steps: [{ name: load-accounts, filepath: load-accounts.sql.tmpl }, { name: load-mappings, filepath: load-mappings.sql.tmpl }, { name: load-rules, filepath: load-rules.sql.tmpl }], local_files: [{ path: accounts.csv, contents: "account_code,balance\nAR-100,1250.00\n" }, { path: mappings.json, contents: '{"AR-100":"receivables"}' }, { path: rules.yaml, contents: "currency: USD\n" }] }
  out:
    - to: ext:Caller
      label: preview and rejection
      rows:
        - { slug: refresh-reporting, config_name: dev, dry_run: true, status: preview, order_mode: linear, steps: [{ step_no: 1, name: collect }, { step_no: 2, name: summarize }, { step_no: 3, name: publish }], errors: [] }
        - { slug: refresh-reporting, config_name: dev, dry_run: false, status: rejected, order_mode: null, steps: [], errors: [policy denied] }
    - to: cache:prepared-invocations
      label: validated invocation
      rows:
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', transaction_policy: pipeline, manifest_checksum: cccccccc, single_run: false, order_mode: linear, concurrency_cap: 1, dry_run: false, steps: [{ step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, sql: 'SELECT 1' }, { step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, sql: 'SELECT 2' }, { step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, sql: 'SELECT 3' }] }
---

Validate policy and all declarations before rendering and execution, including path containment, missing files, duplicate IDs, unknown prerequisites, self-dependencies and cycles. No `needs` keys means linear array order; any `needs` requires every graph declaration to have one, including empty roots. Reject mixed manifests. Prepare every SQL body first and checksum rendered SQL; declaration position supplies `step_no` rather than graph execution order.

Local CSV, JSON and YAML may be explicitly consumed through existing file/template capabilities; their presence does not import rows or create a new input language. The definition examples are normalized payloads, not literal manifest syntax: `local_files` illustrates neighboring file contents, and the templates explicitly reference those files. A dry run returns a preview, and preflight or policy failure returns a rejection, without guard or history. Only real prepared invocations enter [[prepared-invocations]], a sensitive ephemeral handoff, not a resume checkpoint. No raw SQL or secrets in normal responses. Examples use synthetic SQL and eight-character checksum abbreviations.
