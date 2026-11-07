---
kind: cache
title: Prepared Invocations
description: Ephemeral preflighted non-dry-run invocation context awaiting admission.
---

This ephemeral in-memory handoff holds slug, config, executed_by, cli_version, transaction policy, manifest checksum, proposed `single_run` audit snapshot, order mode, concurrency cap and prepared declarations (`step_no`, name, filepath, rendered checksum, SQL, and graph `needs`), with `dry_run: false`. It is neither a database table nor a resume checkpoint. Prepared SQL is sensitive and omitted from normal results and history; dry runs never enter the handoff. SQL and eight-character checksum examples are synthetic.

## Sample values

| slug | config_name | transaction_policy | single_run | order_mode | prepared declarations |
| --- | --- | --- | --- | --- | --- |
| refresh-reporting | dev | pipeline | false | linear | collect, summarize, publish; rendered checksums `bbbbbbbb` |
| load-erp | dev | pipeline | false | graph | stage-api `[]`; clean-accounts and clean-invoices `[stage-api]`; aggregate `[clean-accounts, clean-invoices]`; checksums `bbbbbbbb` |
| load-local | dev | step | false | linear | load-accounts.sql.tmpl, load-mappings.sql.tmpl, load-rules.sql.tmpl consume local CSV, JSON and YAML through existing template capabilities; checksums `bbbbbbbb` |
