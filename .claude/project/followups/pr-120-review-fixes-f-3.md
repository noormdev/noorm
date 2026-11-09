---
id: pr-120-review-fixes-f-3
title: Escaping step that also errors keeps the generic message
created: "2026-11-09"
origin: |
    PR 120 review fixes, iteration 4 reviewer.
kind: finding
severity: risk
review_by: "2027-01-08"
status: open
file: tests/integration/pipeline/boundaries.test.ts:363
---

`tests/integration/pipeline/boundaries.test.ts:363`

In R2/R5/R8 the step errored after the author's COMMIT, so history records "Pipeline execute failed" rather than saying the transaction was ended. The outcome (`unknown`) is correct. Fix: when ownsBeforeRollback fails after a step error, set the step's code and message to TRANSACTION_ESCAPED.

Origin: iteration 4 reviewer.
