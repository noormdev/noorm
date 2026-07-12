# Spec: change retry resumes from the failed file

Ticket: `tickets/v1/17-change-retry-per-file.md` · Finding: QL-safe-04 (`research/v1-audit/quality-lenses/destructive-safety.md`)

The body of this spec is current truth. Superseded decisions live only in the change log.


## Goal

A change that fails partway through (file 2 of 3 breaks) can be fixed and retried without
re-running files that already succeeded, and — on Postgres — a failed change leaves the
database exactly as it was before the attempt (no partial DDL).


## Non-goals

- Rewind/revert semantics (tickets 01, 34) — unchanged.
- Exit-code behavior on change failure (ticket 01) — unchanged.
- Transactional wrapping for MySQL, MSSQL, or SQLite — documented as out of scope with
  rationale (see Approach), not silently attempted.
- Editing `tests/core/change/manager.test.ts`, `tracker.test.ts`, or `history.test.ts` —
  owned by tickets 08/34 running in parallel worktrees off the same `master`. New tests for
  this ticket live in a new file to avoid a merge collision.


## Success criteria

- [ ] A change with files A (succeeds) and B (fails): the failed attempt leaves A recorded
      as succeeded and B as failed. After fixing B on disk, re-running the change executes
      **only** B — A's SQL is not re-submitted. A's history record shows exactly one
      execution.
- [ ] Retrying a change with `force: true` still re-runs every file (force bypasses the
      per-file skip, matching the existing change-level `force` contract).
- [ ] `revertChange` gets the same per-file skip on retry (mirrors `executeChange` — the two
      share `executeFiles`).
- [ ] On Postgres, a change that fails mid-execution leaves no partial state: none of the
      change's DDL/DML is visible afterward, and no operation/file history rows persist
      either (the failed attempt is invisible, not half-recorded) — verified by an
      integration test that is written but not run in this pass (needs a live Postgres;
      recorded for CI group 4).
- [ ] MySQL, MSSQL, and SQLite continue to rely on per-file skip alone (no transactional
      wrapping attempted) — documented inline and in this spec, not silently assumed.
- [ ] `bun run typecheck` and `bun run lint` pass. The new unit test file passes locally.


## Approach

Two independent mechanisms, gated by whether the target dialect supports rolling back DDL:

**Per-file skip (all dialects)** — mirror `runner.ts`'s `Tracker.needsRun` pattern inside
`change/history.ts`: before executing a file, check whether the most recent execution record
for that exact filepath, under this change's `name` + `direction` + config, already shows
`status: 'success'` with a matching checksum. If so, skip it (mark the new attempt's record
`skipped`, don't touch the DB) and move to the next file. This is what makes retries resume
from the failed file for MySQL, MSSQL, SQLite — dialects where each file's DDL commits
immediately as it runs, so a prior success is real and durable.

**Whole-change transaction (Postgres only)** — Postgres is the one dialect here where DDL
participates in transactions normally. For Postgres, wrap the entire `executeFiles` body
(operation creation, per-file execution, history writes, finalize) in one
`context.db.transaction().execute(async (trx) => {...})`, using a `trx`-scoped
`ChangeHistory` instead of the outer one. If any file fails, the callback throws and Kysely
rolls back everything issued inside it — schema changes AND the operation/file history rows
that were about to record them. Nothing persists from a failed Postgres attempt, so a retry's
top-level `history.needsRun` sees "no previous record" and reruns the whole change cleanly.
Per-file skip still runs its check first (unchanged code path — see Outline), but it only
ever finds something to skip if an *older, fully-committed* execution left a real success
record; a rolled-back attempt leaves nothing to find, so the two mechanisms don't conflict —
whole-change atomicity is simply the stronger guarantee for Postgres, and per-file skip is
what carries the retry-safety weight for the other three dialects.

**MySQL** is excluded from transactional wrapping because its DDL statements
(`CREATE`/`ALTER`/`DROP`/`TRUNCATE`) implicitly commit and cannot be rolled back — wrapping
in a Kysely transaction would silently do nothing useful, which is worse than not pretending.

**MSSQL** is excluded for this ticket even though SQL Server can support transactional DDL in
principle: this codebase's MSSQL path also splits files on `GO` batch separators
(`src/core/runner/mssql-batches.ts`), and verifying that batch-split execution composes
safely with a wrapping transaction is unverified work, not assumed. Left as a documented
follow-up rather than silently enabled or silently claimed safe.

**SQLite** is excluded deliberately, not by oversight: SQLite *does* support transactional
DDL, but this ticket's primary per-file-skip guarantee is unit-tested against in-memory
SQLite, and that test requires file A's `CREATE TABLE` to commit independently of file B's
failure. Wrapping SQLite transactionally would collapse that scenario into all-or-nothing and
contradict the per-file-skip contract SQLite is standing in for (MySQL/MSSQL retry safety).

No design doc — this is scoped, mechanical work confined to one module pair
(`change/executor.ts`, `change/history.ts`) with a well-understood precedent already in the
codebase (`runner.ts` + `runner/tracker.ts`).


## Change tree

    src/core/change/
    ├── history.ts ....................... M  (add ChangeHistory.needsRunFile)
    └── executor.ts ....................... M  (per-file skip check; force threaded into
                                                 executeFiles; Postgres transactional wrap)
    tests/core/change/
    └── executor-retry.test.ts ............ A  (new file — per-file skip unit tests)
    tests/integration/change/
    └── postgres-transaction.test.ts ...... A  (new file — pg-gated, written but not run
                                                 this pass)


## Outline

    src/core/change/history.ts
      ChangeHistory
        needsRunFile — per-file retry check: most recent execution record for this
                       filepath under this change's name+direction+config; success with
                       matching checksum means skip, anything else means run

    src/core/change/executor.ts
      TRANSACTIONAL_DIALECTS — the set of dialects where wrapping in a DB transaction
                                actually rolls back DDL (postgres only for this ticket)
      executeFiles — gains a `force` parameter; per-file loop now calls needsRunFile before
                     load/render/execute and records a `skipped` result instead of
                     re-running when the file already succeeded; when the resolved dialect
                     is in TRANSACTIONAL_DIALECTS, the whole function body (operation
                     creation through finalize) executes inside context.db.transaction(),
                     using a trx-scoped ChangeHistory; on rollback, returns a failed result
                     with no operationId (nothing persisted to reference)
      executeChange — passes opts.force through to executeFiles (unchanged otherwise)
      revertChange — passes opts.force through to executeFiles (unchanged otherwise)

    tests/core/change/executor-retry.test.ts
      change: executor retry
        A succeeds, B fails, fix B, retry — retry executes only B; A's execution record
          shows exactly one success; overall result succeeds after retry
        force: true re-runs every file even when a prior success record exists

    tests/integration/change/postgres-transaction.test.ts
      integration: postgres change transaction
        failed change leaves no trace — table from the succeeding file does not exist
          after rollback, and no operation/file history rows persist
        retry after rollback runs the whole change again — since nothing persisted,
          the top-level needsRun sees a fresh change, not a partial one


## Flows

Flow: retry resumes from the failed file (MySQL/MSSQL/SQLite — per-file skip)

1. `executeChange` runs file A (succeeds, history row → `success`) then file B (fails,
   history row → `failed`); remaining files (if any) marked `skipped`; operation finalized
   `failed`.
2. Caller fixes file B's SQL on disk.
3. Caller re-runs `executeChange`. Top-level `history.needsRun` sees status `failed` →
   allows retry. A NEW operation record is created (fresh `pending` file rows, as today).
4. Inside `executeFiles`'s per-file loop, before touching file A: `history.needsRunFile`
   looks up the most recent execution record for A's filepath under this change's
   name+direction — finds the PRIOR operation's `success` row with a matching checksum →
   returns `needsRun: false`. File A's new record is marked `skipped`; A's SQL is never
   submitted.
5. File B: `needsRunFile` finds the prior `failed` row → `needsRun: true`. B's (now-fixed)
   SQL runs, succeeds, history row → `success`.
6. Operation finalizes `success`. A ran exactly once (in step 1); B ran twice (failed once,
   succeeded once) — expected, since B is the file that needed fixing.

Flow: Postgres whole-change rollback

1. `executeChange` resolves dialect `postgres` → wraps `executeFiles`'s body in
   `context.db.transaction().execute(trx => {...})`, using a `trx`-scoped `ChangeHistory`.
2. File A's DDL runs via `trx`, succeeds (not yet durable — transaction still open).
3. File B's DDL runs via `trx`, fails. The callback throws.
4. Kysely rolls back the transaction: file A's DDL is undone, and the operation/file history
   rows created inside the same `trx` are undone too — nothing persists.
5. `executeFiles` catches the throw (outside the transaction) and returns a failed
   `ChangeResult` built from in-memory failure info, `operationId: undefined`.
6. Caller fixes file B, re-runs. Top-level `history.needsRun` finds no record for this
   change (the failed attempt left none) → reason `new` → the whole change runs again,
   fresh, inside a new transaction. Both A and B execute; this time both succeed; the
   transaction commits; history rows persist for the first time.


## Checkpoints

Each checkpoint ends green: the new test file(s) for that checkpoint, `bun run typecheck`,
`bun run lint`. Commit per green checkpoint. Do not run other test files, test groups, or
integration/docker suites — this work is scoped to Change Executor (`core-change` domain);
full-suite verification happens centrally, not per-ticket.

| CP | Scope | Key files | Done when |
|---|---|---|---|
| 1 | Per-file skip on retry | `src/core/change/history.ts` (`needsRunFile`), `src/core/change/executor.ts` (force threading, per-file skip check), `tests/core/change/executor-retry.test.ts` | New test: A-succeeds/B-fails/fix/retry executes only B, A's history shows one success. `force: true` re-runs both. `bun test tests/core/change/executor-retry.test.ts` green, `bun run typecheck`, `bun run lint` green. |
| 2 | Postgres transactional wrap | `src/core/change/executor.ts` (`TRANSACTIONAL_DIALECTS`, transaction wrap), `tests/integration/change/postgres-transaction.test.ts` (written, not run) | Production code wraps `executeFiles` in `context.db.transaction()` when dialect is postgres; failed result has no `operationId`. Integration test file exists, follows the `tests/utils/db.ts` `createTestConnection`/`skipIfNoContainer('postgres')` convention, is NOT executed (no live DB in this pass). `bun run typecheck`, `bun run lint` green. |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Forcing a real SQL failure in in-memory SQLite for the CP1 test may hit the flakiness noted in `tests/core/change/executor.test.ts` (`it.skip(...)`, commit `991723d`, "SQLite error propagation is unreliable in CI (Ubuntu)") | medium | Use a syntactically invalid statement (parse-time error) for the failing file, not a duplicate-table constraint violation (the pattern that was flaky) — different failure code path. Run the new test file several times locally before treating it as done. If still flaky, fall back to seeding `ChangeHistory` records directly (bypass live SQL failure, assert the skip logic against seeded state) and note the substitution in `TESTING.md`. |
| Kysely `Transaction<DB>` compatibility with `ChangeHistory`'s constructor (typed `Kysely<NoormDatabase>`) | low | Already proven in this codebase: `src/core/version/schema/migrations/v2.ts` uses `db.transaction().execute(async (trx) => {...})` with `trx` passed into query builders the same way. |
| CP2's integration test can't be verified without a live Postgres in this pass | expected, not a risk to mitigate | Explicitly out of scope for local verification per the ticket; write the test, record it in `TESTING.md` for CI group 4, do not attempt to run it. |


## Change log

- 2026-07-12 — Initial spec (autonomous audit-ticket delivery, no design doc per ticket
  scope).
