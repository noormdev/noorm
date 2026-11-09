---
id: pr-120-review-fixes-f-31
title: Uncoded pre-admission TUI failures still point at history
created: "2026-11-09"
origin: |
    PR 120 review fixes, audit-fix iteration 1 reviewer.
kind: finding
severity: question
review_by: "2027-01-08"
status: open
file: src/tui/screens/pipeline/PipelineRunScreen.tsx:201
---

`src/tui/screens/pipeline/PipelineRunScreen.tsx:201`

Target-changed, shutting-down, already-running, and context/migration failures from `usePipelineOperations` leave no run row but show "Inspect scoped history…".

Origin: audit-fix iteration 1 reviewer.
