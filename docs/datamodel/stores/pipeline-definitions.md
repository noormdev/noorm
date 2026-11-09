---
kind: file
title: Pipeline Definitions
description: Manifest declarations, SQL files, and local template inputs for pipeline preparation.
---

Definitions are source files, not invocation records. A manifest supplies transaction policy, concurrency, `singleRun`, input declarations and steps with names, SQL paths and optional named `needs`; declaration position becomes `step_no`. Inputs declare type (`string`, `number`, `integer`, `boolean`, `object` or `array`), description and optional required, default and scalar choices. No `needs` means linear; graph manifests specify `needs` on every step. Preparation normalizes both to numeric prerequisite snapshots. The manifest checksum identifies source bytes, while the step checksum identifies rendered SQL. Local data is available through existing file/template capabilities, never automatically imported. Eight-character checksums below are illustrative abbreviations.

## Sample values

| slug | manifest_checksum | policy and declarations | local data |
| --- | --- | --- | --- |
| refresh-reporting | `cccccccc` | `pipeline`, concurrency 4, `singleRun: false`, required string input `region`: collect, summarize, publish (linear) | none |
| load-erp | `1234abcd` | `pipeline`: stage-api `[]`, clean-accounts `[stage-api]`, clean-invoices `[stage-api]`, aggregate `[clean-accounts, clean-invoices]` | none |
| load-erp | `2345abcd` | `step`: same diamond dependencies | none |
| load-local | `3456abcd` | `step`: load-accounts.sql.tmpl, load-mappings.sql.tmpl, load-rules.sql.tmpl | accounts.csv, mappings.json, rules.yaml, explicitly referenced by templates |
