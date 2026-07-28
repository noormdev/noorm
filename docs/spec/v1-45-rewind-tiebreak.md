# Spec: v1-45 rewind — apply-order tiebreak

Ticket: `tickets/v1/45-rewind-tiebreak-order.md` (realm repo). Discovered 2026-07-13: un-skipping the two ticket-34-gated rewind tests (the SQLite date crash is fixed) exposed an independent ordering bug. Branch: `v1/45-rewind-tiebreak` off `next` @ `b971f2f`. Reviewers diff against `b971f2f`. **v1-blocker.**

## Goal

`ChangeManager.rewind()` (`src/core/change/manager.ts` ~369) sorts applied changes by `appliedAt` descending with no tiebreaker. Ties are routine — `change ff` applies several changes in one process within the same clock tick, and SQLite datetime is second-precision — and on a tie the sort preserves `list()` insertion order (oldest-first). Observed failures (reproduced by un-skipping the two tests):

- `rewind(2)`: reverts oldest-first within the tie group (`result.changes[0]` was the *older* change) — dependency-violating for DDL reverts.
- `rewind(name)`: `findIndex` against the mis-sorted list truncates the slice — reverted only the named change, leaving the newer change applied on top of a reverted base.

Fix: the history table's autoincrement `id` (`src/core/change/types.ts:449/492` — `ChangeHistoryRecord.id`) is the true apply-order key. Investigate whether the objects `list()` returns carry it (they're hydrated in `src/core/change/history.ts` ~200-260); if not, plumb it through the list surface (additive optional field), then sort by `appliedAt` desc with `id` desc as tiebreak — or by `id` alone if every applied entry reliably has one (implementer verifies which; document the choice in the diff). Non-tied ordering must be provably unchanged.

## Checkpoints

| # | Checkpoint | Files | Agent | Verifies |
|---|---|---|---|---|
| 1 | Tiebreak fix + un-skip | `src/core/change/manager.ts`, possibly `src/core/change/history.ts` + types, `tests/core/change/manager.test.ts` | atomic-implementer (mode: feature) | The two `it.skip` rewind tests (~lines 261, 299 — comments reference this ticket) un-skipped and green; new tie-specific test: two changes with identical `appliedAt` revert id-descending; existing manager tests untouched and green; `bun run typecheck` clean. TDD: run the un-skipped tests RED first (they fail on `b971f2f` — verify), then fix. |

## Non-goals

- Changing what revert executes per change; revert-file ordering within a change; `change revert` (single) semantics.
- History-table schema changes — `id` already exists.

## Acceptance criteria (from ticket)

- `rewind(2)` reverts newest-first; `rewind(name)` reverts everything down to and including the named change; tie-specific test green; non-tied behavior unchanged.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `list()` items genuinely lack the history id and plumbing it touches many call sites | medium | The field is additive/optional on the status type; only rewind consumes it. If the blast radius exceeds ~3 files, stop and record in STATE.md. |
| Multiple history rows per change (re-applies) make id ambiguous | medium | Use the id of the row that produced `appliedAt` (the latest successful apply) — the hydration site in history.ts already selects that row for appliedAt; take id from the same record. |

## Change log

- 2026-07-13 — initial spec, authored by orchestrator pre-implementation.

## Implementation log

### shipped — 2026-07-14

Built across 1 iteration of /subagent-implementation. Commits (chronological):

- `a3c4eb6` — spec added
- `8f770f8` — CP-1 tiebreak fix: appliedHistoryId plumbed through ChangeStatus/ChangeListItem (types.ts), sourced from the history row's autoincrement id in history.ts's getStatus()/getAllStatuses(), consumed as id-descending tiebreak in manager.ts rewind()'s sort (appliedAt stays primary key)
- `0df96a2` — followup F-1 deferred

**Out-of-scope work performed during this build:**

- none — blast radius held to exactly the 3 files predicted (types.ts, history.ts, manager.ts) plus the test file.

**Unforeseens — surprises that emerged during implementation:**

- Ticket/spec text claimed "two" ticket-34-gated it.skip tests in tests/core/change/manager.test.ts (~261, ~299); only one existed (line 254 pre-edit) — the ticket-34 SQLite date-hydration fix had already landed on this branch's base (b971f2f) and the second skip it originally referenced lived in a different file (tests/cli/run/change-rewind.test.ts), outside this ticket's scoped test surface. Verified via baseline run (10 pass, 1 skip, 0 fail on b971f2f) before touching code. Resolved by un-skipping the one existing test and adding the new tie-specific test the checkpoint called for; both satisfy the ticket's acceptance criteria.
- `ChangeListItem` is also constructed in `src/tui/utils/change-loader.ts` (three call sites) without setting `appliedHistoryId` — left the field optional/additive rather than touching that file, keeping blast radius at 3 files per the spec's risk budget. TUI callers unaffected since they don't consume the field.

**Deferred items still open:**

- `v1-45-rewind-tiebreak-f1` (project-level followup, risk): the new tie-specific test (and the pre-existing sibling at ~line 250) force the appliedAt tie via wall-clock timing coincidence rather than a deterministically forced equal executed_at — rare risk of false confidence on a run that straddles a second boundary. Not blocking; deferred rather than fixed in this iteration since it's a pre-existing test-technique pattern, not a regression introduced here.
