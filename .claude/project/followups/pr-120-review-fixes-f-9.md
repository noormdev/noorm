---
id: pr-120-review-fixes-f-9
title: Unreachable `?? 0` in the U& encoder
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP2 iteration 7 reviewer.
kind: finding
severity: nit
review_by: "2027-01-08"
status: open
file: src/core/pipeline/sql-literal.ts:39
---

`src/core/pipeline/sql-literal.ts:39`

`char.codePointAt(0) ?? 0` cannot reach the fallback, because `for..of` always yields a code point. If it ever did, it would encode NUL silently. It is kept because the repo bans `!`.

Origin: CP2 iteration 7 reviewer.
