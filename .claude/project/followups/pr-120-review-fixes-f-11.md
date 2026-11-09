---
id: pr-120-review-fixes-f-11
title: Table tests pass the dialect to two helpers
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP2 iteration 8 reviewer.
kind: finding
severity: nit
review_by: "2027-01-08"
status: open
file: tests/integration/pipeline/input-literals.test.ts:161
---

`tests/integration/pipeline/input-literals.test.ts:161`

Each table test passes the same dialect to `withTableDatabase` and `withPipelineFixture`. Running the fixture inside the table helper's callback would remove the repeat.

Origin: CP2 iteration 8 reviewer.
