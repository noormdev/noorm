---
id: pr-120-review-fixes-f-25
title: Style drift in the pipeline screens
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP5 iteration 3 reviewer.
kind: finding
severity: nit
review_by: "2027-01-08"
status: open
file: src/tui/screens/pipeline/PipelineHistoryScreen.tsx:60-64
---

`src/tui/screens/pipeline/PipelineHistoryScreen.tsx:60-64`, `PipelineHistoryDetailScreen.tsx:71-75`, `PipelineRunScreen.tsx:2`

The history screens use a braced single-statement `else`, and PipelineRunScreen does not. PipelineRunScreen imports `@logosdx/utils` between its two react imports.

Origin: CP5 iteration 3 reviewer.
