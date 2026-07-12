# Display/formatting consolidation

Ticket: `tickets/v1/23-formatting-consolidation.md` · Decision: `tickets/v1/00-DECISIONS.md` D7 (keep voca, adopt it)

The body of this spec is current truth. Superseded decisions live only in the change log.


## Goal

Consolidate six hand-rolled string/format helpers that duplicate either each other or an already-installed dependency (voca, `@logosdx/utils`, dayjs, native `Date`) into one implementation each. Per D7, voca stays a dependency and gets adopted at its duplication sites rather than removed. Output stays byte-identical everywhere it's cheap to prove; the two spots where the replacement library's output genuinely differs from the hand-rolled original (documented below) are called out explicitly rather than shipped silently.


## Non-goals

- No behavior change beyond what's explicitly documented as a diff (CP-2 byte-size format, CP-4 embedded-dot camelCase, CP-5 non-ASCII slugify).
- No new abstraction layer invented to normalize a library's output back to the old hand-rolled shape — voca/dayjs/`@logosdx/utils` are called directly at each site.
- `dayjs` is not removed as a dependency — the TUI's `relativeTime` usage (`src/tui/utils/date.ts`, `SqlHistoryScreen.tsx`'s `.fromNow()`) stays untouched and legitimate.
- `voca` is not removed as a dependency (D7 supersedes AP-std-01's drop recommendation).
- No SDK/DB/connection-facing code — display/formatting helpers only.


## Success criteria

- [ ] One shared `formatAccessTag` used by both `src/cli/config/list.ts` and `ConfigListScreen.tsx`; no duplicate template-literal/local function remains.
- [ ] `SqlClearScreen.tsx`'s local `formatBytes` deleted; `formatByteSize` from `@logosdx/utils` used instead.
- [ ] All three hand-rolled `truncate()` implementations deleted; all three call sites use voca's `v.truncate`.
- [ ] `template/utils.ts`'s hand-rolled `camelCase` deleted; `v.camelCase` used; the file's "using Voca" docblock is now true.
- [ ] `change/scaffold.ts`'s hand-rolled `slugify` deleted; `v.slugify` used.
- [ ] `change/scaffold.ts`'s hand-rolled `formatDate` deleted; `dayjs(date).format('YYYY-MM-DD')` used.
- [ ] `dayjs` import and all format calls removed from `src/core/logger/logger.ts`'s hot path; replaced with a small native-`Date` formatter. `dayjs` remains in `package.json` dependencies, unchanged.
- [ ] Every documented output diff (CP-2, CP-4, CP-5) is verified against existing tests/fixtures and called out here, not silently shipped.
- [ ] `bun run typecheck`, `bun run lint`, `bun run build` clean; targeted tests (below) green.


## Approach

No design doc — this is a mechanical, already-ruled consolidation (D7), not a design decision.

**Chosen:** adopt each library's API directly at every duplication site (voca for camelCase/slugify/truncate, `@logosdx/utils` `formatByteSize`, dayjs for `scaffold.ts`'s date, native `Date` for the logger hot path) and accept the library's native output format as-is.

**Rejected:** wrapping the new library calls in adapter functions that reconstruct the old hand-rolled output byte-for-byte (e.g. a `formatBytesLikeBefore()` shim around `formatByteSize`). Rejected because it reintroduces the exact hand-rolled-duplication problem this ticket exists to remove, for the sake of preserving a cosmetic format nothing tests depend on — contradicts D7's "adopt it, don't reinvent" ruling and the simplicity ladder (YAGNI).


## Change tree

    src/cli/config/list.ts ................................ M  (call shared formatAccessTag)
    src/core/change/scaffold.ts ............................ M  (slugify/formatDate -> voca/dayjs)
    src/core/logger/index.ts ............................... M  (export new timestamp formatters)
    src/core/logger/logger.ts .............................. M  (drop dayjs hot-path calls)
    src/core/logger/timestamp.ts ........................... A  (formatLogTimestamp, formatLogTimestampIso)
    src/core/policy/check.ts ............................... M  (new: formatAccessTag, next to guarded())
    src/core/policy/index.ts ............................... M  (export formatAccessTag)
    src/core/template/utils.ts ............................. M  (camelCase -> v.camelCase)
    src/tui/components/terminal/ResultTable.tsx ............ M  (truncate -> v.truncate)
    src/tui/screens/config/ConfigListScreen.tsx ............. M  (formatAccessTag -> shared import)
    src/tui/screens/db/SqlClearScreen.tsx ................... M  (formatBytes -> formatByteSize)
    src/tui/screens/db/SqlHistoryScreen.tsx ................. M  (truncateSql -> v.truncate)
    src/tui/screens/debug/DebugListScreen.tsx ............... M  (truncate -> v.truncate)
    tests/core/policy/check.test.ts ......................... M  (+ formatAccessTag cases)
    tests/core/logger/timestamp.test.ts ..................... A  (formatLogTimestamp/Iso, exact-value + offset math)


## Outline

src/core/policy/check.ts
  formatAccessTag — display-only `user:<role> mcp:<role|off>` string, null when `!guarded(config)`

src/core/logger/timestamp.ts
  formatLogTimestamp — `YY-MM-DD HH:mm:ss` from native Date getters
  formatLogTimestampIso — `YYYY-MM-DDTHH:mm:ss.SSS±HH:mm` from native Date getters + getTimezoneOffset

src/core/change/scaffold.ts
  (no new named pieces — `formatDate`/`slugify` local functions deleted, call sites point at `dayjs(...).format(...)`/`v.slugify(...)`)

src/core/template/utils.ts
  (no new named pieces — local `camelCase` deleted, `toContextKey` calls `v.camelCase` directly)

src/tui/screens/db/SqlClearScreen.tsx, SqlHistoryScreen.tsx, debug/DebugListScreen.tsx, components/terminal/ResultTable.tsx
  (no new named pieces — local `formatBytes`/`truncate`/`truncateSql` deleted, call sites point at `formatByteSize`/`v.truncate` directly)


## Flows

None — pure internal-implementation consolidation. No new user-facing behavior; the screens/commands that call these formatters (`config list`, `ConfigListScreen`, `SqlClearScreen`, `SqlHistoryScreen`, `DebugListScreen`, `ResultTable`, change scaffolding, the logger) are unchanged in shape and trigger conditions — only the formatting implementation underneath changes.


## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Shared `formatAccessTag` | `src/core/policy/check.ts`, `index.ts`, `src/cli/config/list.ts`, `src/tui/screens/config/ConfigListScreen.tsx` | atomic-implementer (mode: feature) | 4 | `tests/cli/config/list.test.ts` (3 cases, subprocess against compiled binary), new `tests/core/policy/check.test.ts` cases |
| 2 | `formatBytes` → `formatByteSize` | `src/tui/screens/db/SqlClearScreen.tsx` | atomic-implementer (mode: feature) | 1 | manual/typecheck — no existing test locks the old format; documented diff below |
| 3 | Three `truncate()` → `v.truncate` | `src/tui/screens/db/SqlHistoryScreen.tsx`, `src/tui/screens/debug/DebugListScreen.tsx`, `src/tui/components/terminal/ResultTable.tsx` | atomic-implementer (mode: feature) | 3 | direct algebraic/spot-check comparison (voca formula == hand-rolled formula for both ellipsis variants); no existing unit test, byte-identical confirmed by inspection |
| 4 | `camelCase` → `v.camelCase` | `src/core/template/utils.ts` | atomic-implementer (mode: feature) | 1 | `tests/core/template/utils.test.ts` (6 existing cases, all pass unchanged) |
| 5 | `slugify` → `v.slugify` | `src/core/change/scaffold.ts` | atomic-implementer (mode: feature) | 1 | `tests/core/change/scaffold.test.ts` (existing ASCII cases pass unchanged) |
| 6 | `formatDate` → `dayjs(...).format(...)` | `src/core/change/scaffold.ts` | atomic-implementer (mode: feature) | 1 (same file as CP-5) | `tests/core/change/scaffold.test.ts` (`'2025-06-15-custom-date-test'` case) |
| 7 | dayjs removed from logger hot path | `src/core/logger/logger.ts`, new `src/core/logger/timestamp.ts`, `src/core/logger/index.ts` | atomic-implementer (mode: feature) | 3 | `tests/core/logger/output.test.ts` (regex shape, existing), new `tests/core/logger/timestamp.test.ts` (exact-value lock) |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| CP-2: `formatByteSize`'s output format (`"512b"`/`"1.5kb"`, no space, lowercase) visibly differs from the old `"512 B"`/`"1.5 KB"` on the SQL-history clear-stats screen | certain (by design) | Documented here as a deliberate, called-out diff. No test asserts the old format; cosmetic-only, display screen only. `{ decimals: 1 }` preserves the old precision even though casing/spacing changes. |
| CP-3: voca's `v.truncate` produces different output than the hand-rolled `truncate()`s | low — verified algebraically identical for both ellipsis variants (`'...'` default, `'…'` via 3rd arg) across representative inputs | If a future input class diverges, existing screens are display-only (SQL history, debug list, result table) — low blast radius. No action needed unless a future review finds a concrete counter-example. |
| CP-4: voca's `v.camelCase` splits on embedded dots in a basename in addition to `-`/`_`/case-boundaries, unlike the hand-rolled version | low — only affects `toContextKey` on side-car data filenames with a literal dot surviving extension-stripping (e.g. `'user.roles.json5'` → `'userRoles'` instead of `'user.roles'`) | Documented here (found in review). No existing test/fixture uses a dotted multi-word basename — not a regression against current coverage. Arguably an improvement: the old output was an unusable bare property-access key. |
| CP-5: voca's `v.slugify` transliterates diacritics where the hand-rolled version collapsed them to hyphens | low — only affects non-ASCII change descriptions (e.g. `'café münchën'` → `'cafe-munchen'` instead of `'caf-m-nch-n'`) | Documented here. No test exercises non-ASCII descriptions. Improvement, not regression — old output was a mangled slug. |
| CP-7: native timestamp formatter reproduces dayjs's `Z`-token semantics (local UTC offset as `±HH:mm`) incorrectly | low — this is *not* `Date.toISOString()`'s `Z`-suffix behavior, an easy mistake | New `tests/core/logger/timestamp.test.ts` derives the expected offset from `Date#getTimezoneOffset()` directly (timezone-portable assertion), locking the exact format rather than trusting a regex shape alone. |


## Change log

<!-- Populated on first amendment after the spec is approved. Do not log drafting/refinement turns. -->

## Implementation log

### shipped — 2026-07-12

Built in 1 implement→review iteration of `/subagent-implementation`. Commits (chronological):

- `bceb391` — CP-1..CP-7 all checkpoints: shared `formatAccessTag`, `formatByteSize`, voca `truncate`/`camelCase`/`slugify`, dayjs `formatDate`, native logger timestamp formatter
- `0711a2e` — spec restructured to match `atomic validate spec`'s required template (Change tree/Outline/Flows/Risks/Change log, tabular Checkpoints); no content change, structure only

**Out-of-scope work performed during this build:**

- none — all 7 checkpoints stayed within the ticket's stated scope (formatting/string helpers only)

**Unforeseens — surprises that emerged during implementation:**

- Reviewer found an undocumented output divergence in CP-4 (voca `camelCase` splits on embedded dots, hand-rolled didn't) not caught by the 6 existing test cases. Dispositioned same iteration: documented in the spec's Risks table rather than requiring a re-implementation round — confirmed to be a non-regression (no test/fixture exercises dotted basenames) and arguably an improvement.
- Initial spec draft used prose `### CP-N` subsections instead of `atomic validate spec`'s required tabular `## Checkpoints` + `## Change tree`/`## Outline`/`## Flows`/`## Risks`/`## Change log` structure. Caught at finalize verification, restructured before shipping (commit `0711a2e`).

**Deferred items still open:**

- none — the one non-blocking finding (F-1, embedded-dot camelCase) was dispositioned in-iteration (documented, not deferred). See `FOLLOWUPS.md` in the task scratchpad for the full trail.
