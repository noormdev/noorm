---
kind: cache
title: Prepared Invocations
description: Ephemeral preflighted non-dry-run invocation context awaiting admission.
---

This ephemeral in-memory handoff holds slug, config, executed_by, cli_version, transaction policy, manifest checksum, the manifest's `single_run` audit snapshot, order mode, concurrency cap, immutable resolved structured input and prepared declarations (`step_no`, name, filepath, rendered checksum, SQL and numeric `needs`). The input was reserved as `$.input` for all templates and includes; rendering finishes before SQL starts. It is neither a database table nor a resume checkpoint. Input and prepared SQL are sensitive and omitted from normal results and history; dry runs never enter the handoff. SQL and eight-character checksum examples are synthetic.

## Sample values

| slug | config_name | transaction_policy | single_run | order_mode | prepared declarations |
| --- | --- | --- | --- | --- | --- |
| refresh-reporting | dev | pipeline | false | linear | input `region: east`; collect `[]`, summarize `[1]`, publish `[2]`; rendered checksums `bbbbbbbb` |
| load-erp | dev | pipeline | false | graph | stage-api `[]`; clean-accounts and clean-invoices `[1]`; aggregate `[2,3]`; checksums `bbbbbbbb` |
| load-local | dev | step | false | linear | load-accounts `[]`, load-mappings `[1]`, load-rules `[2]` consume local CSV, JSON and YAML through existing template capabilities; checksums `bbbbbbbb` |
