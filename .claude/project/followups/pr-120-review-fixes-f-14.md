---
id: pr-120-review-fixes-f-14
title: '`setPaths` is the only `set*` that merges'
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP3 iteration 1 reviewer.
kind: finding
severity: risk
review_by: "2027-01-08"
status: open
file: src/core/settings/manager.ts:740
---

`src/core/settings/manager.ts:740`

`setBuild`, `setStrict`, `setLogging` and `setTeardown` replace their section. `setPaths` merges, and only its JSDoc says so. A rename (for example `updatePaths`) would make it visible at the call site.

Origin: CP3 iteration 1 reviewer.
