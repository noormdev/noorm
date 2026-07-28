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
# - Test: bun run test (CI splits into 4 serial groups — see .claude/rules and docs/wiki/index.md)

## Ignore for domains
# - vendor/
# - generated/
