---
id: pr-120-review-fixes-f-4
title: Non-ASCII dollar-tag test title describes the attack
created: "2026-11-09"
origin: |
    PR 120 review fixes, iteration 7 reviewer.
kind: finding
severity: nit
review_by: "2027-01-08"
status: open
file: tests/core/pipeline/sql-guard.test.ts:187
---

`tests/core/pipeline/sql-guard.test.ts:187`

Retitle to "masks non-ASCII PostgreSQL dollar tags, so a quote between them cannot hide a later control", matching :179.

Origin: iteration 7 reviewer.
