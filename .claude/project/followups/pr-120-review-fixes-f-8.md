---
id: pr-120-review-fixes-f-8
title: MSSQL `$.quote` value containing a line `GO` is unstorable
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP2 iteration 4 reviewer.
kind: finding
severity: risk
review_by: "2027-01-08"
status: open
file: src/core/runner/mssql-batches.ts
---

`src/core/runner/mssql-batches.ts` (splitMssqlBatches)

The batch splitter splits inside the N'' literal. Batch 1 fails with Err 105, so it fails closed with no injection, but the data can't be stored. Pre-existing splitter behaviour.

Origin: CP2 iteration 4 reviewer.
