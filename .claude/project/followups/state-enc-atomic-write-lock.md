---
id: state-enc-atomic-write-lock
title: 'state.enc: atomic write + inter-process lock + pre-migration backup'
created: "2026-07-08"
origin: |
    challenge-swarm #40 (migration F3/F4, ops F2/F6)
kind: finding
severity: risk
review_by: "2026-09-06"
status: open
file: src/core/state/manager.ts:304
---

persist() is a bare writeFileSync to the live path — no temp+rename, no lock, no .bak. needsMigration is effectively always-true (identity never emitted by migrateState) so every load persists. Concurrent MCP-server + CLI/TUI on one state.enc can corrupt the single encrypted store holding all configs+secrets; a crash mid-write loses everything with no backup. Pre-exists the access-roles branch. Fix: write-temp+rename (atomic on POSIX), a lockfile around load/persist, state.enc.bak before first migration.
