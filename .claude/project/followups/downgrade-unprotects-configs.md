---
id: downgrade-unprotects-configs
title: Downgrade after schemaVersion-2 migration silently unprotects all configs
created: "2026-07-08"
origin: |
    challenge-swarm #40 (ops F1, migration F1/F2)
kind: finding
severity: risk
review_by: "2026-09-06"
status: open
file: src/core/version/state/migrations/v2.ts:46
---

DEFERRED by product owner (alpha). After state migrates to schemaVersion 2 (protected dropped), any prior binary reads protected as undefined -> fail-open, and re-persists without the marker. No shipped release has a version guard (schemaVersion system was dead until this branch). When leaving alpha: ship a forward version-guard in load() (refuse/warn on newer state) + state.enc.bak, and document the caveat. Not actionable retroactively for already-shipped binaries.
