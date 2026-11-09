---
id: pr-120-review-fixes-f-24
title: '`attempt` treats a falsy throw as success'
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP5 iteration 1 reviewer.
kind: finding
severity: risk
review_by: "2027-01-08"
status: open
file: src/core/pipeline/executor.ts:328,410,503
---

`src/core/pipeline/executor.ts:328,410,503`

`@logosdx/utils` `attempt` returns the raw thrown value, so `throw undefined` reads as success. In `commitBoundary` that records `committed`. Real drivers throw `Error`, and the convention is repo-wide.

Origin: CP5 iteration 1 reviewer.
