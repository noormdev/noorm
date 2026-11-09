---
id: pr-120-review-fixes-f-30
title: Should `pipeline run --json` keep the error `code`?
created: "2026-11-09"
origin: |
    PR 120 review fixes, final audit.
kind: finding
severity: question
review_by: "2027-01-08"
status: open
file: src/cli/pipeline/run.ts:94
---

`src/cli/pipeline/run.ts:94`

`--json` keeps only `phase` and `stepNo`, so an operator cannot tell `TRANSACTION_ESCAPED` from `OWNERSHIP_UNVERIFIED`, which decide recovery. Both are fixed text. The JSON shape predates the loop.

Origin: final audit.
