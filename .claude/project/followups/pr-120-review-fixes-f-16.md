---
id: pr-120-review-fixes-f-16
title: Only `setPaths` clones its event payload
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP3 iteration 3 reviewer.
kind: finding
severity: nit
review_by: "2027-01-08"
status: open
file: src/core/settings/manager.ts:739-751
---

`src/core/settings/manager.ts:739-751`

`setBuild`, `setStrict` and the other setters emit their raw input, so a listener could mutate the stored document through them.

Origin: CP3 iteration 3 reviewer.
