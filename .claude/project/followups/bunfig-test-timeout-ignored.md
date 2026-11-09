---
id: bunfig-test-timeout-ignored
title: bunfig test timeout is ignored; suite runs at Bun's 5 s default
created: "2026-11-09"
origin: |
    PR 120 CI failure, atomic-auditor
kind: finding
severity: risk
review_by: "2027-01-08"
status: open
file: bunfig.toml:3
---

Bun 1.4.4 does not read `[test] timeout = 30000` or `concurrency = 1` from bunfig.toml (neither key is in the bunfig reference; a 7 s test and a 7 s `beforeAll` both fail at 5000 ms with the key set). Every local and CI run uses the 5 s default, and the suite compensates with 113 per-test and 25 hook timeouts, 40 of them exactly 30 s. CI run 42594263373 failed two subprocess-loop tests in tests/cli/pipeline/commands.test.ts on this.

Fix:

1. Add `setDefaultTimeout(30_000)` to tests/preload.ts; it covers tests and hooks for every invocation.
2. Delete the dead `timeout` and `concurrency` keys from bunfig.toml.
3. Drop per-test overrides of 30 s or less; keep the deliberate 2000 ms hang guards in tests/core/dt/reader.test.ts.
4. Correct .claude/rules/testing.md:9 and regenerate docs/wiki/infra.md, which both repeat the dead settings.
