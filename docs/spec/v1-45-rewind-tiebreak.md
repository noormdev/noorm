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
