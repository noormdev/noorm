---
process: Prepare Pipeline
number: 1
description: Validate and prepare a fresh invocation or return a preview or rejection without creating history.
inputs:
  - from: ext:Caller
    label: invocation request
    data: slug, resolved config_name, executed_by, cli_version, identity and policy context, structured input object, explicit CLI input flags, dry_run and confirmation
  - from: file:pipeline-definitions
    label: pipeline definition
    data: slug, manifest bytes and checksum, transaction policy, concurrency, singleRun, input declarations with type description required default and choices, declared steps with name SQL filepath and optional named needs, local CSV JSON YAML and template files
outputs:
  - to: ext:Caller
    label: preview or rejection
    data: slug, config_name, dry_run, status, order mode, declared step numbers and names, errors
  - to: cache:prepared-invocations
    label: prepared invocation
    data: slug, config_name, executed_by, cli_version, transaction_policy, manifest_checksum, single_run, order_mode, concurrency cap, immutable resolved input, declared steps with step_no, name, filepath, rendered checksum, prepared SQL and numeric needs, dry_run=false
examples:
  in:
    - from: ext:Caller
      label: invocation and preview
      rows:
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', policy_context: allowed, input: { region: west }, flags: { region: east }, dry_run: false, confirmation: true }
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', policy_context: allowed, input: { region: east }, flags: {}, dry_run: true, confirmation: true }
    - from: file:pipeline-definitions
      label: linear and diamond manifests
      rows:
        - { slug: refresh-reporting, manifest_checksum: cccccccc, transaction_policy: pipeline, concurrency: 4, singleRun: false, inputs: { region: { type: string, description: Reporting region, required: true } }, steps: [{ name: collect, filepath: collect.sql }, { name: summarize, filepath: summarize.sql }, { name: publish, filepath: publish.sql }] }
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
        - { slug: refresh-reporting, config_name: dev, executed_by: synthetic-operator, cli_version: '1.0.0', transaction_policy: pipeline, manifest_checksum: cccccccc, single_run: false, order_mode: linear, concurrency_cap: 1, input: { region: east }, dry_run: false, steps: [{ step_no: 1, name: collect, filepath: collect.sql, checksum: bbbbbbbb, sql: 'SELECT 1', needs: [] }, { step_no: 2, name: summarize, filepath: summarize.sql, checksum: bbbbbbbb, sql: 'SELECT 2', needs: [1] }, { step_no: 3, name: publish, filepath: publish.sql, checksum: bbbbbbbb, sql: 'SELECT 3', needs: [2] }] }
---

Validate policy and all declarations before rendering and execution, including path containment, missing files, duplicate IDs, unknown prerequisites, self-dependencies and cycles. No `needs` keys means linear array order; any `needs` requires every graph declaration to have one, including empty roots. Normalize linear predecessors and graph labels to numeric declaration positions. Prepare every SQL body once before workflow SQL; `step_no` is declaration position, not graph execution order.

Resolve structured input from CLI JSON or SDK input, with explicit CLI flags overriding JSON and defaults filling gaps. Validate declared types, choices and JSON-compatible values; prompt only for missing required values when interactive and permitted, otherwise report all missing values. SDK never prompts. Bind the immutable resolved snapshot as reserved `$.input` with final precedence for every step and include. Local CSV, JSON and YAML remain available through existing template capabilities and are never automatically imported.

A dry run returns a sanitized preview; preflight or policy failure returns a rejection, without admission or history. Only real prepared invocations enter [[prepared-invocations]], a sensitive ephemeral handoff, not a resume checkpoint. Neither raw input nor rendered SQL appears in normal responses or audit. Examples are illustrative and use synthetic SQL and eight-character checksum abbreviations.
