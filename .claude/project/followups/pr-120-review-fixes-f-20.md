---
id: pr-120-review-fixes-f-20
title: '`DEFAULT_HISTORY_LIMIT` is declared between two functions'
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP4b iteration 2 reviewer.
kind: finding
severity: nit
review_by: "2027-01-08"
status: open
file: src/core/pipeline/history.ts:72
---

`src/core/pipeline/history.ts:72`

Move it up with the other module-level declarations.

Origin: CP4b iteration 2 reviewer.
