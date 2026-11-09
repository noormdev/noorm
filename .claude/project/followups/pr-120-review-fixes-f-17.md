---
id: pr-120-review-fixes-f-17
title: The `index.d.ts` row in the d.ts assertion cannot fail
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP4b iteration 2 reviewer.
kind: finding
severity: nit
review_by: "2027-01-08"
status: open
file: tests/sdk/bundle-smoke.test.ts:147
---

`tests/sdk/bundle-smoke.test.ts:147`

`index.d.ts` is a 29-byte stub (`export * from './index.cjs';`). Only the `.d.cts` row checks anything. Keep the row as a guard for a future full `.d.ts`, or drop it.

Origin: CP4b iteration 2 reviewer.
