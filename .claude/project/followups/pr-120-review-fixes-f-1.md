---
id: pr-120-review-fixes-f-1
title: Should MSSQL procedure, trigger and function bodies be excluded from the managed guard?
created: "2026-11-09"
origin: |
    PR 120 review fixes, iteration 1 reviewer.
kind: finding
severity: question
review_by: "2027-01-08"
status: open
file: src/core/pipeline/sql-guard.ts:149
---

`src/core/pipeline/sql-guard.ts:149`

Under a managed transaction, `CREATE PROCEDURE p AS BEGIN BEGIN TRAN ... COMMIT END` is now rejected, although creating the procedure does not run its body. PostgreSQL `$$` and `BEGIN ATOMIC` bodies are excluded. Excluding T-SQL module bodies requires parsing up to the end of the batch.

Origin: iteration 1 reviewer.
