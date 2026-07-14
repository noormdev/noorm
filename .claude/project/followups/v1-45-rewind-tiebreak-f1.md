---
id: v1-45-rewind-tiebreak-f1
title: rewind tiebreak tests rely on wall-clock timing, not forced tie
created: "2026-07-14"
origin: |
    docs/spec/v1-45-rewind-tiebreak.md, iter 1 reviewer (checkpoint 1)
kind: finding
severity: risk
review_by: "2026-09-12"
status: open
file: tests/core/change/manager.test.ts:291-316
---

tests/core/change/manager.test.ts:291-316 (new tie-specific test) and the pre-existing test at ~line 250 force an appliedAt tie by relying on two sequential manager.run() calls landing within the same wall-clock second (SQLite CURRENT_TIMESTAMP second-precision), rather than deterministically forcing equal executed_at values. In the rare case the two calls straddle a second boundary, the test would still pass (non-tied ordering is unaffected by the tiebreak fix) but would not actually exercise the new appliedHistoryId tiebreak logic for that run -- false confidence, not a false failure. Fix: force the tie deterministically, e.g. by writing two history rows with an identical executed_at value directly, or by stubbing the clock during the two run() calls in this test file specifically.
