---
id: pr-120-review-fixes-f-13
title: Hardcoded `__noorm_pipeline_run__` table name
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP2 iteration 9 reviewer.
kind: finding
severity: nit
review_by: "2027-01-08"
status: open
file: tests/integration/pipeline/input-literals.test.ts:81
---

`tests/integration/pipeline/input-literals.test.ts:81`

The repo convention is `getNoormTables(dialect)`. The literal is correct because the helper is MySQL-only.

Origin: CP2 iteration 9 reviewer.
