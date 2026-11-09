---
id: pr-120-review-fixes-f-21
title: Two forms for passing `config` into render contexts
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP4b iteration 2 reviewer.
kind: finding
severity: risk
review_by: "2027-01-08"
status: open
file: src/core/runner/context.ts:37
---

`src/core/runner/context.ts:37`

`{ ...activeConfig }` differs from the seven builders that still use `as unknown as Record<string, unknown>` (sdk run/changes/templates, cli preview/inspect, RunInspectScreen, change-context). The CP5 cast sweep should pick one form, preferably by typing the context field correctly.

Origin: CP4b iteration 2 reviewer.
