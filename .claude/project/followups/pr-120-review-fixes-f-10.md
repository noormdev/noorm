---
id: pr-120-review-fixes-f-10
title: '`withPipelineDatabase` writes `pool: undefined` for every caller'
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP2 iteration 7 reviewer.
kind: finding
severity: nit
review_by: "2027-01-08"
status: open
file: tests/utils/pipeline-db.ts:58
---

`tests/utils/pipeline-db.ts:58`

This is harmless while `TEST_CONNECTIONS` has no pool. It would overwrite one if a pool were added to the base config later.

Origin: CP2 iteration 7 reviewer.
