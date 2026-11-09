---
id: pr-120-review-fixes-f-23
title: '`[comments] max_lines = 2` conflicts with the JSDoc @example rule'
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP5 iteration 1 reviewer.
kind: finding
severity: risk
review_by: "2027-01-08"
status: open
file: .claude/atomic.toml
---

`.claude/atomic.toml` (no override), `.claude/rules/typescript.md`

The repo rule asks for usage examples on public JSDoc, and the comment cap flags every `@example` block as OVER. The CP5 diff carries 4 justified OVER entries (runPipeline, SDK run/history/getRun). Exempt JSDoc @example in the tool config, or raise the cap. This is a separate change.

Origin: CP5 iteration 1 reviewer.
