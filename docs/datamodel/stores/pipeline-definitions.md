---
kind: file
title: Pipeline Definitions
description: Versioned manifest definitions and ordered SQL file references for proposed pipeline invocations.
---

Definitions are the source material read during preparation, distinct from audit records of invocations. Each definition supplies a slug, manifest checksum, transaction policy, and ordered steps containing `step_no`, `name`, `path`, and `sql_checksum`. A definition is not itself a run and does not imply checksum-based skipping or resume. Checksums below are abbreviated to eight characters; values are illustrative.

## Sample values

| slug | manifest_checksum | transaction_policy | steps |
| --- | --- | --- | --- |
| refresh-reporting | `cccccccc` | pipeline | `[{step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb}, {step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb}, {step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb}]` |
| refresh-reporting | `eeeeeeee` | step | `[{step_no: 1, name: collect, path: collect.sql, sql_checksum: bbbbbbbb}, {step_no: 2, name: summarize, path: summarize.sql, sql_checksum: bbbbbbbb}, {step_no: 3, name: publish, path: publish.sql, sql_checksum: bbbbbbbb}]` |
