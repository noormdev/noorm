# Spec: `change rewind` exit code on partial failure


- ticket: tickets/v1/01-change-rewind-exit-code.md (v1-blocker, effort S)
- finding: VR-cli-01 (research/v1-audit/v1-release/cli-contract.md)
- branch: `v1/01-rewind-exit`


## Goal


CI must stop when a rewind partially fails. `noorm change rewind` currently exits 0 and logs at info level when `ChangeManager.rewind()` returns `status: 'partial'` (some reverts succeeded, at least one failed — schema left in a mixed state). Every sibling batch command maps the three-way status with `status === 'success' ? 0 : 2`, matching the documented contract "`0` success, `2` partial failure, `1` complete failure" (docs/headless.md:688). Bring rewind in line.


## Contract


| Rewind result status | Exit code | Summary log level (non-JSON) |
|----------------------|-----------|------------------------------|
| `success` | 0 | `logger.info` |
| `partial` | 2 | `logger.error` |
| `failed` | 2 | `logger.error` |

Unchanged: pre-execution errors (`withContext` error, no result) keep exiting 1; `--json` output shape unchanged; per-change line logging unchanged.


## Evidence


- `src/cli/change/rewind.ts:119` — bug: `process.exit(result.status === 'failed' ? 2 : 0)` ('partial' exits 0)
- `src/cli/change/rewind.ts:70-79` — bug: `if (res.status === 'failed')` logs the partial summary at info level
- `src/cli/change/run.ts:121`, `src/cli/change/revert.ts:121`, `src/cli/change/ff.ts:96`, `src/cli/change/next.ts:97` — sibling pattern `status === 'success' ? 0 : 2`
- `src/core/change/manager.ts:486` — status derivation: `failed > 0 ? (executed > 0 ? 'partial' : 'failed') : 'success'`
- `src/core/change/types.ts` — `BatchChangeResult.status: 'success' | 'failed' | 'partial'`
- `docs/headless.md:688` — documented exit-code contract


## Prescription (exact)


In `src/cli/change/rewind.ts` only:

1. Log-level branch (line 70): `if (res.status === 'failed')` becomes `if (res.status !== 'success')`.
2. Exit expression (line 119): `process.exit(result.status === 'failed' ? 2 : 0)` becomes `process.exit(result.status === 'success' ? 0 : 2)`.

Plus one new test file (see CP-1). No other production change.


## Test construction notes (verified against source — do not improvise)


New test file: `tests/cli/run/change-rewind.test.ts`, mirroring `tests/cli/run/change-ff.test.ts` (same harness `tests/cli/run/_setup.ts`: isolated SQLite project, spawns compiled CLI at `dist/cli/index.js` as a subprocess — run `bun run build` before the test, and rebuild after changing rewind.ts, or the spawned CLI runs stale code).

Recipe for a real `'partial'` rewind (all facts verified against source):

- `manager.rewind()` reverts applied changes most-recent-first and `abortOnError` defaults to `true` (`src/core/change/manager.ts:51-57`) — it breaks on the first failed revert. So the LATER-applied change must have a revert that succeeds (counted `executed`), and the EARLIER-applied change a revert that fails (counted `failed`); then `executed > 0 && failed > 0` yields `'partial'`.
- A failing revert must be a `revert/` folder containing SQL that errors at execution (e.g. `SELECT * FROM nonexistent_table_xyz;`). A MISSING `revert/` folder does NOT produce a failed result — `revertChange` throws `ChangeValidationError` (`src/core/change/executor.ts:281-289`), which propagates out of `rewind()` and hits the CLI's error path (exit 1). Do not use a missing revert folder.
- Rewind ordering sorts by `appliedAt` timestamp. Apply the two changes with two separate `noorm change run <name>` invocations (not one `change ff`) so `appliedAt` values are unambiguously distinct.
- Change layout: `changes/<name>/change/001.sql` and `changes/<name>/revert/001.sql`.

Scenario (names illustrative):

    changes/2025-01-01-first/change/001.sql   CREATE TABLE t1 (id INTEGER PRIMARY KEY);
    changes/2025-01-01-first/revert/001.sql   SELECT * FROM nonexistent_table_xyz;   -- fails
    changes/2025-01-02-second/change/001.sql  CREATE TABLE t2 (id INTEGER PRIMARY KEY);
    changes/2025-01-02-second/revert/001.sql  DROP TABLE t2;                          -- succeeds

    noorm change run 2025-01-01-first
    noorm change run 2025-01-02-second
    noorm change rewind 2025-01-01-first
    (reverts second: ok, then first: fails -> status 'partial' -> must exit 2)

Test naming per `.claude/rules/testing.md`: `describe('cli: noorm change rewind — ...')`.


## Checkpoints


| # | Checkpoint | Independently verifiable by |
|---|------------|------------------------------|
| CP-1a | `tests/cli/run/change-rewind.test.ts` asserts a full-success rewind exits 0, end-to-end against the compiled CLI | `bun run build && bun test tests/cli/run/change-rewind.test.ts` |
| CP-1b | Same file contains the partial-rewind exit-2 test, authored per the recipe below but `it.skip`'d with an inline rationale — blocked by the pre-existing SQLite `appliedAt` bug (see Discovered blocker). Un-skip once that bug is fixed | read the file; skip rationale cites the blocker |
| CP-2 | `src/cli/change/rewind.ts` exit expression is `result.status === 'success' ? 0 : 2` | read line ~119 |
| CP-3 | `src/cli/change/rewind.ts` summary log branch is `res.status !== 'success'` routed to `logger.error` | read lines ~70-79 |
| CP-4 | Typecheck and lint green | `bun run typecheck && bun run lint` |


## Discovered blocker (iteration 1 — verified first-hand)


The spec's original CP-1 required the partial-rewind exit-2 assertion to run green in the SQLite harness. That is currently impossible: a `'partial'` result needs >= 2 applied changes, and with >= 2 applied changes `ChangeManager.rewind()` crashes before computing any status — `.sort()` at `src/core/change/manager.ts:369-376` calls `a.appliedAt?.getTime()`, but on the SQLite dialect `appliedAt` is a raw string (driver returns `executed_at` unparsed; `src/core/change/history.ts:172`), not the `Date | null` its type declares (`src/core/change/types.ts:140`). The `TypeError` propagates to the CLI error path and exits 1. Reproduced empirically against the compiled CLI: two applied changes, `change rewind <first>` exits 1 with `a.appliedAt?.getTime is not a function`.

Consequences:

- Real (non-test) `noorm change rewind` against SQLite with >= 2 applied changes is broken in production today, independent of this ticket.
- The fix lives in `src/core/change/` (manager/history), explicitly out of scope here. Deferred as a follow-up finding (F-1) for a new ticket.
- The partial-path exit code is verifiable today only via integration databases (postgres/mysql/mssql drivers return real `Date`s) — deferred per protocol; the unit-harness assertion lands when F-1 is fixed.


## Acceptance criteria (ticket, verbatim)


- A partial rewind exits 2 and logs at error level (test asserting exit code, mirroring sibling command tests).
- Full-success rewind still exits 0.


## Out of scope


- Retry/resume semantics for partial rewinds (ticket 17).
- Any change to `src/core/change/manager.ts`, `executor.ts`, or the `BatchChangeResult` type.
- Sibling commands (run/revert/ff/next/transfer) — already correct.
- `docs/headless.md` — already documents the correct contract; no doc change needed.
- `tests/integration/**`, docker services, whole test groups — a central runner owns full verification.
- The `--json` output shape and the `withContext` error path (exit 1) — unchanged.


## Change log


- 2026-07-12 — initial spec from ticket 01 + VR-cli-01, all evidence re-verified against worktree source.
- 2026-07-12 — iteration 1: CP-1 split into CP-1a/CP-1b after discovering the pre-existing SQLite `appliedAt` string bug makes a 'partial' rewind unconstructible in the unit harness (crash verified first-hand). Partial assertion authored but skipped; fix itself unchanged.


## Implementation log

### shipped (branch v1/01-rewind-exit, pending merge) — 2026-07-12

Built across 1 iteration of /subagent-implementation. Commits (chronological):

- `693235e` — spec authored (contract, verified evidence, partial-status test recipe)
- `0c158ea` — CP-1a/CP-1b/CP-2/CP-3/CP-4: two-expression fix in rewind.ts + change-rewind.test.ts (full-success asserted e2e; partial authored, skipped)

**Out-of-scope work performed during this build:**

- none (core/change untouched; spec amendment CP-1 → CP-1a/CP-1b was documentation of reality, not scope change)

**Unforeseens — surprises that emerged during implementation:**

- Pre-existing production bug: SQLite `appliedAt` returned as string; `manager.rewind()` sort comparator throws with >= 2 applied changes (exit 1 before status computation). Verified first-hand via compiled-CLI repro. Made the partial-exit-2 assertion unconstructible in the unit harness; handled by authoring the test per spec recipe and `it.skip`-ing with a line-cited rationale (see Discovered blocker).

**Deferred items still open:**

- F-1 (FOLLOWUPS.md, this loop's scratchpad): fix SQLite timestamp parsing at the history/connection seam, then un-skip the partial test — needs its own ticket; also reportable as a new v1-audit finding since `change rewind` on SQLite with >= 2 applied changes is broken today.
- Partial-path exit-code behavior is integration-verifiable today (postgres/mysql/mssql) — central runner / integration lane decision belongs to the fleet orchestrator.
