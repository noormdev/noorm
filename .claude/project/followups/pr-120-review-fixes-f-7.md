---
id: pr-120-review-fixes-f-7
title: MySQL three-reading guard rejects `\'` before a `;` and control word
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP2 iteration 4 reviewer.
kind: finding
severity: risk
review_by: "2027-01-08"
status: open
file: src/core/pipeline/sql-guard.ts:192
---

`src/core/pipeline/sql-guard.ts:192`

`SELECT 'it\'s', 'a; commit'` is valid default-mode MySQL but is rejected under managed modes, because the NBE reading exposes `; commit`. This is fail-closed by design. Workaround: write `''`. Document it in the guide.

Origin: CP2 iteration 4 reviewer.
