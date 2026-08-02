---
type: Steering
description: Authoritative steering for the signals/wiki inferrer when operating under docs/wiki/.
---

<steering note: user hints to correct framework detection / domain grouping / build-test commands;
 the inferrer reads this and treats it as authoritative>

## Framework
# Bun workspace monorepo — TypeScript, Ink/React TUI, Citty CLI, Kysely SQL layer

## Domains
# - docs/wiki/index.md's Domains table is already correct; no override needed here

## Build
# - Build: bun run build
# - Test: bun run test (CI splits into 5 serial groups — see .github/workflows/ci.yml)
#   1 core (non-transfer)  2 transfer (isolated)  3 CLI  4 CLI logger settings (isolated)  5 integration
# - The old "known contamination" note blaming src/core/config/index.ts:34 does NOT reproduce:
#   that call passes memoizeOpts: false, so lookups re-read process.env. The real cause is
#   bun's mock.module registry being process-global and never restoring.

## Ignore for domains
# - vendor/
# - generated/
