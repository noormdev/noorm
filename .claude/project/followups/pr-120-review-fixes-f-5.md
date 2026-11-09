---
id: pr-120-review-fixes-f-5
title: Escape-body comment sits on the shared helper
created: "2026-11-09"
origin: |
    PR 120 review fixes, iteration 7 reviewer.
kind: finding
severity: nit
review_by: "2027-01-08"
status: open
file: tests/integration/pipeline/boundaries.test.ts:292
---

`tests/integration/pipeline/boundaries.test.ts:292`

The probe-failure tests use the same helper but hide nothing. Move the comment to the R1-R10 describe block at :344.

Origin: iteration 7 reviewer.
