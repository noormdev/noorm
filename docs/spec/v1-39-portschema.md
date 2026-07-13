# Spec: v1-39 extract one shared PortSchema

- Ticket: `tickets/v1/39-core-portschema-dedup.md`
- Findings: F-2 (`docs/spec/v1-11-validation-source.md#out-of-scope`) — ticket 11 consolidated
  the TUI hand-copies of the port-bound rule down to each domain's authoritative Zod schema,
  but deliberately left the two core schemas themselves unmerged pending a design decision on
  where the shared definition should live.
- **Stacked branch.** Base is `v1/11-validation-source` at `6890e80` (effective code tip
  `4c5de4e` — `6890e80` only adds that ticket's implementation log, no source change). Ticket 11
  is itself stacked on `v1/29-locked-stage-guard`. Review/CI scope for this ticket is the delta
  on top of `6890e80`.

## Goal

`src/core/config/schema.ts` and `src/core/settings/schema.ts` each declare a module-private
`PortSchema` with the identical rule (`z.number().int().min(1).max(65535)`, same two error
messages). Two definitions of one rule can silently drift. Extract a single shared
`PortSchema`; both domain schemas consume it instead of declaring their own.

## Contract

- **Home.** `PortSchema` is declared once in `src/core/connection/defaults.ts` — the same file
  ticket 11 put `DEFAULT_PORTS` in, and the natural neutral home per the ticket's prescription
  ("a neutral `core/connection` or `core/shared` location, matching where `DEFAULT_PORTS`
  landed"). `defaults.ts` has no import back into `core/config` or `core/settings` today (only
  `import type { Dialect } from './types.js'`), so this direction of dependency (state → connection)
  introduces no cycle — it also already exists implicitly, since both domains already consume
  `DEFAULT_PORTS` from this module's neighborhood.
- **Re-export, don't relocate consumers.** `src/core/config/schema.ts` and
  `src/core/settings/schema.ts` each `import { PortSchema } from '../connection/defaults.js'`
  and re-export it under the same name (`export { PortSchema };`). This keeps both domains'
  existing named export surface unchanged — `src/tui/utils/config-validation.ts` (`import {
  ConfigNameSchema, PortSchema } from '../../core/config/schema.js'`) and
  `src/tui/utils/settings-validation.ts` (`import { PortSchema } from
  '../../core/settings/schema.js'`), both wired by ticket 11, need no changes.
- **Barrel.** `src/core/connection/index.ts` gains `PortSchema` alongside its existing
  `DEFAULT_PORTS` re-export, for symmetry and any future direct consumer.
- **No behavior change.** Same bounds (1-65535 inclusive), same two error messages ("Port must
  be at least 1" / "Port must be at most 65535"), same `.int()` requirement. This is a pure
  dedup — the existing config/settings schema test files are the safety net; no new test is
  needed unless a shape changes (it doesn't).

## Checkpoints

| # | Scope | Done when |
|---|-------|-----------|
| 1 | `core/connection/defaults.ts` (add `PortSchema`, zod import); `core/connection/index.ts` (re-export it); `core/config/schema.ts` (import + re-export, drop local declaration); `core/settings/schema.ts` (import + re-export, drop local declaration) | `tests/core/config/schema.test.ts` and `tests/core/settings/schema.test.ts` still green, unmodified. `bun run typecheck` clean. `rg '\.min\(1\).*\.max\(65535\)|\.max\(65535\).*\.min\(1\)' src` (or equivalent multi-line check) finds exactly one port-bound declaration, in `core/connection/defaults.ts`. `rg 'export const PortSchema' src` finds exactly one declaration site (`core/connection/defaults.ts`) plus the two re-export lines in config/settings schema.ts are `export { PortSchema };`, not a second `export const`. |

## Acceptance criteria (verbatim from ticket 39)

- One `PortSchema` definition; config and settings both import it; `rg` finds no second
  `.min(1).max(65535)` port declaration.
- Behavior unchanged (same bounds).

## Out of scope

- Ticket 11's TUI consolidation — already done, not touched here.
- Changing the port-bound values or error messages.
- Touching `DEFAULT_PORTS` or any dialect factory.
- Relocating or renaming the TUI consumers' import paths (`core/config/schema.js`,
  `core/settings/schema.js`) — they keep importing `PortSchema` from the same domain schema
  file as before; only that file's internal declaration becomes a re-export.

## Change log

- 2026-07-12 — initial spec.
