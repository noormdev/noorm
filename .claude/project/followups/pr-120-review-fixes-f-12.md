---
id: pr-120-review-fixes-f-12
title: '`escapeRefused` is declared below its first caller'
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP2 iteration 9 reviewer.
kind: finding
severity: nit
review_by: "2027-01-08"
status: open
file: tests/integration/pipeline/input-literals.test.ts:79
---

`tests/integration/pipeline/input-literals.test.ts:79`

`expectMysqlEscapeRefused` calls `escapeRefused`, which is declared at :139. Moving it above the helpers at :68 would put the definition first.

Origin: CP2 iteration 9 reviewer.
