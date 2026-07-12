# Spec: v1-35 `db create` SQLite `created` flag

Ticket: `tickets/v1/35-createdb-sqlite-created-flag.md`. Finding origin: ticket 08's F-1
(`.claude/.scratchpad/2026-07-12-v1-08/FOLLOWUPS.md`), pinned as the `it.skip` at
`tests/cli/db/create.test.ts:163` on branch `v1/08-dangerous-tests`.

**Stacked branch.** This work branches from `v1/08-dangerous-tests` (commit `35e19e6`), not
`master` — the skipped test this ticket un-skips lives there. Worktree:
`.worktrees/v1-35-createdb-flag` on branch `v1/35-createdb-flag`. Review scope is this branch's
delta on top of `35e19e6` only; ticket 08's own diff is out of review scope here.

## Goal

`noorm db create` against a SQLite target always reports `created: false` in its JSON output,
even on a genuine fresh create. Fix the SQLite existence-detection ordering so `created` is
reported truthfully, and un-skip ticket 08's pinned regression test.

## Root cause (confirmed via source read, matches ticket 08's F-1 citation)

1. `createDb` (`src/core/db/operations.ts:133`) calls `checkDbStatus(config)` to decide whether
   to create.
2. `checkDbStatus` (`src/core/db/operations.ts:36`) calls
   `testConnection(config, { testServerOnly: true })` as its connectivity probe.
3. `testConnection` (`src/core/connection/factory.ts:230`) only swaps to a dialect's system
   database when `config.dialect !== 'sqlite'` (`SYSTEM_DATABASES.sqlite` is `undefined` —
   factory.ts:195). For SQLite it connects directly to the target file.
4. Opening that connection (`createConnection` → the sqlite driver) auto-creates the target file
   as a side effect — this is exactly why `sqliteDbOperations.createDatabase`
   (`src/core/db/dialects/sqlite.ts:38-41`) is a no-op with the comment "SQLite creates the file
   automatically when connecting."
5. Back in `checkDbStatus` (`operations.ts:51`), `ops.databaseExists(config, config.database)`
   now runs *after* the probe already created the file, so it reports `exists: true` for a
   target that was empty a moment ago.
6. `createDb` (`operations.ts:149`) checks `if (!status.exists)` — false, since step 5 already
   flipped it — so the `created = true` assignment (`operations.ts:159`) never runs, and
   `createDb` returns `created: false` (`operations.ts:203`) for a genuinely fresh SQLite target.

Postgres/mysql/mssql are unaffected: their `testConnection` probe swaps to a system database
(`postgres`/`master`/no-database respectively), so the probe never touches the target database
and never auto-creates it. `databaseExists` for those dialects queries the server's catalog, not
a filesystem side effect of connecting.

## Fix

Capture SQLite file existence *before* `checkDbStatus`'s connectivity probe runs, and use that
captured value instead of the (now-unreliable) post-probe `databaseExists` result — for SQLite
only.

`src/core/db/operations.ts`, inside `checkDbStatus`:

- Hoist `const ops = getDialectOperations(config.dialect);` to the top of the function (currently
  created after the probe, at the current line 50) — needed early because the pre-probe check
  reuses `ops.databaseExists`, not a duplicated `existsSync` call.
- Before calling `testConnection`, for `config.dialect === 'sqlite'` only, call
  `await ops.databaseExists(config, config.database)` and capture the result (e.g.
  `sqlitePreProbeExists`). For non-sqlite dialects this stays `undefined` — no extra call, no
  behavior change to their path.
- After the existing post-probe `databaseExists` call (still wrapped in `attempt()`, still runs
  for every dialect so the `existsErr` branch is unaffected), resolve
  `exists = sqlitePreProbeExists ?? existsAfterProbe` and use `exists` in the `!exists` branch and
  the final return.

Why reuse `ops.databaseExists` rather than a fresh `existsSync` call inline in `operations.ts`:
the dialect module already owns the `:memory:` special case (`sqlite.ts:28-32`, always "exists")
and the `config.filename ?? dbName` resolution (`sqlite.ts:25`) — duplicating that logic in
`operations.ts` would create a second place that can drift from the dialect's own rules. Calling
`ops.databaseExists` twice for SQLite (pre- and post-probe) is a cheap `existsSync` each time —
no live connection, no dialect-specific query cost.

Why gate to `config.dialect === 'sqlite'` rather than hoisting the check for every dialect: pg/
mysql/mssql's `databaseExists` implementations query the live server (not a filesystem stat), so
calling them before `testConnection` has verified server reachability would issue a second,
unverified connection attempt and change their existing behavior/timing — explicitly out of
scope per the ticket's scope boundary ("don't alter the connectivity probe's other
responsibilities").

## Root cause — iteration 1 correction (double `checkDbStatus` invocation)

Iteration 1's implementer found the root-cause chain above is **necessary but not sufficient**.
`src/cli/db/create.ts:56` calls `checkDbStatus(config.connection)` as its own preliminary status
check (to decide whether to short-circuit before calling `createDb` at all — see
`create.ts:65-74`). `createDb` (`operations.ts:133`) then calls `checkDbStatus` a **second,
independent** time internally. For a genuinely fresh SQLite target, the CLI's first call (call A)
correctly captures pre-probe non-existence (per the fix above) — but call A's own connectivity
probe still auto-creates the file as a side effect. By the time `createDb`'s internal call
(call B) runs its own pre-probe check, the file already exists on disk (created by call A's
probe), so call B's `sqlitePreProbeExists` is `true`, and `created` never flips to `true`. The
fix above is correct *for a single `checkDbStatus` invocation in isolation* (and is still needed
for callers that invoke `createDb` without a preliminary status check), but the actual
`noorm db create` CLI path calls `checkDbStatus` twice, and the first call's side effect poisons
the second.

**Additional fix — thread the CLI's already-computed status through `createDb`.** The ticket's
own prescription explicitly sanctions this: "or otherwise thread the pre-probe existence state
through so `createDb` reports `created` truthfully for SQLite." Blast radius check: `createDb`
has exactly one caller in `src/` (`src/cli/db/create.ts:77`); `checkDbStatus` has exactly two call
sites (`create.ts:56` and `operations.ts:144` inside `createDb`) — confirmed via
`grep -rn "createDb(\|checkDbStatus(" src/ --include="*.ts"`. Small, contained surface.

- `src/core/db/types.ts`: add an optional `precheckedStatus?: DbStatus` field to
  `CreateDbOptions`. JSDoc: reusing an already-computed status avoids re-deriving existence after
  the caller's own probe has already touched the SQLite target file.
- `src/core/db/operations.ts`'s `createDb`: destructure `precheckedStatus` from `options`; replace
  `const status = await checkDbStatus(config);` with
  `const status = precheckedStatus ?? await checkDbStatus(config);` — when the caller supplies a
  status, skip the redundant internal call entirely.
- `src/cli/db/create.ts`: pass its already-computed `status` (from line 56) through to the
  `createDb` call at line 77: `createDb(config.connection, configName, { precheckedStatus: status })`.

This does not change `createDb`'s behavior for any caller that doesn't pass `precheckedStatus`
(optional, backward compatible — no other caller exists today). It does not change
`checkDbStatus`'s own behavior or signature. For postgres/mysql/mssql, `checkDbStatus` is
idempotent (queries the live catalog, no auto-create side effect), so calling it once via the
CLI's preliminary check and reusing that result in `createDb` produces identical `exists`/
`trackingInitialized` values to calling it twice — no value-level behavior change, only one fewer
redundant network round trip. Verify this explicitly in review: the pg/mysql/mssql `created`
value must be unchanged, not just "probably fine because the code path is untouched."

Trace confirming the corrected fix (fresh SQLite target, full `noorm db create` CLI run):
1. CLI call A (`create.ts:56`): `checkDbStatus` — `sqlitePreProbeExists = false` (file doesn't
   exist yet) — captured before the probe. Probe runs, auto-creates the file. Post-probe
   `existsAfterProbe = true`, but `exists = false ?? true = false` (nullish coalescing keeps the
   pre-probe `false`). Returns `{serverOk:true, exists:false, trackingInitialized:false}`.
2. CLI short-circuit check (`create.ts:65`): `false && false` → does not short-circuit.
3. CLI calls `createDb(config.connection, configName, { precheckedStatus: status })`.
4. `createDb` uses `precheckedStatus` directly — no second `checkDbStatus` call. `status.exists`
   is `false` (from step 1) → `ops.createDatabase` runs (no-op for sqlite), `created = true`.
   `initializeTracking && !trackingInitialized` → bootstraps tracking, `trackingInitialized = true`.
5. Returns `{ok:true, created:true, trackingInitialized:true}` → CLI JSON output has
   `created: true`. Matches the un-skipped test's assertion.

Existing-target and short-circuit paths are unaffected by this trace (the short-circuit path
never reaches `createDb`, so `precheckedStatus` threading is inert there) — verified by re-running
`tests/cli/db/create.test.ts`'s other two tests plus CP2's new test after this correction.

## Contract

| Scenario | `checkDbStatus(...).exists` | `createDb(...).created` |
|----------|------------------------------|--------------------------|
| SQLite, target file does not exist before `db create` runs | `false` (pre-probe check) | `true` |
| SQLite, target file already exists before `db create` runs | `true` | `false` |
| SQLite, `:memory:` target | `true` (unchanged — dialect's existing special case) | `false` (unchanged — treated as always-existing) |
| Postgres/MySQL/MSSQL, target does not exist | `false` (unchanged path) | `true` (unchanged) |
| Postgres/MySQL/MSSQL, target exists | `true` (unchanged path) | `false` (unchanged) |

## Checkpoint table

| CP | Area | File(s) | Level | CI group |
|----|------|---------|-------|----------|
| 1 | SQLite existence-detection fix + status threading + un-skip | `src/core/db/operations.ts`, `src/core/db/types.ts`, `src/cli/db/create.ts`, `tests/cli/db/create.test.ts` | fix + CLI/subprocess (real SQLite file, requires `dist/cli/index.js`) | group 3 (`tests/cli`) — needs `bun run build` first |
| 2 | SQLite existing-path regression test | `tests/cli/db/create.test.ts` (new `it`, sibling to the un-skipped one) | CLI/subprocess, real SQLite file | group 3 (`tests/cli`) |
| 3 | pg/mysql/mssql unchanged-semantics check | wherever existing dialect coverage for `checkDbStatus`/`createDb` lives (unit-level if a fake/stub server or existing fixture supports it; otherwise record as integration for the central runner — see Testing) | unit or integration | group 1 (`tests/core`) or group 4 (`tests/integration`) depending on what's feasible without a live DB |

## CP1 — SQLite existence-detection fix + un-skip

1. Un-skip `it.skip('created is true when the JSON output reports a genuinely fresh create', ...)`
   at `tests/cli/db/create.test.ts:163` → `it(...)`. Do not change its assertions — the test
   already asserts the correct expected behavior (`parsed.created === true`), only the current
   buggy implementation fails it.
2. Remove the block comment directly above that `it.skip` (`tests/cli/db/create.test.ts` lines
   ~140-162) that documents the bug as unfixed/deferred — it no longer describes current state
   once the fix lands. Replace with a short comment (or none, if the test reads clearly on its
   own) — do not leave a stale "this is broken, tracked elsewhere" comment next to a passing test.
3. Implement the fix in `src/core/db/operations.ts`'s `checkDbStatus` exactly as described above.
4. Confirm the existing fresh-create test in the same file (`'creates the database and
   initializes tracking when the target does not exist yet'`, the one immediately above the
   un-skipped test) still passes — it doesn't assert `created` directly but exercises the same
   fresh-create path and must not regress.
5. Confirm the already-exists short-circuit test (`'short-circuits without re-running createDb
   when the target already exists and is initialized'`, below the un-skipped test) still passes
   — this is the `created: false`-on-existing-target case; must stay green and stay `false`.

## CP2 — SQLite existing-path regression test

The ticket's acceptance criteria call for testing **both** directions explicitly ("on a
non-existent SQLite path reports `created: true`; on an existing one, `created: false` (test
both)"). CP1 step 5 covers the existing-path case implicitly via the pre-existing short-circuit
test, but that test's primary assertion is about `alreadyExists`/mtime-unchanged, not a direct,
named assertion that `created` is deterministically `false` when the file existed *before* `db
create` ran at all (as opposed to `false` on a *second* call within the same test). Add one new
`it` in `tests/cli/db/create.test.ts`, sibling to the un-skipped test:

- Pre-create the target SQLite file directly (e.g. `writeFileSync(dbPath, '')` or run `db create`
  once and discard its output) so the file exists *before* the assertion-under-test's `db create`
  invocation runs.
- Run `db create --json` against that pre-existing target.
- Assert `parsed.created === false`.

This closes the gap between "short-circuit doesn't re-run destructively" (already covered) and
"the `created` flag itself is correctly `false` for a target that existed going in" (the ticket's
explicit ask).

## CP3 — pg/mysql/mssql unchanged-semantics check

Confirm the fix in `checkDbStatus` does not alter `created` reporting for postgres/mysql/mssql.
The pre-probe branch is gated on `config.dialect === 'sqlite'`, so non-sqlite dialects fall
through to `exists = existsAfterProbe` exactly as before the fix — this is a structural guarantee
from the implementation, not just an assumption to verify by inspection.

- If existing unit-level coverage of `checkDbStatus`/`createDb` for pg/mysql/mssql already exists
  (check `tests/core/connection/`, `tests/core/db/` if present) and can run without a live
  database (e.g. against a stub/fake dialect factory), add or confirm a `created: true`-on-fresh
  / `created: false`-on-existing assertion per dialect there.
- If no such unit-level harness exists and exercising pg/mysql/mssql requires a live database
  (per `tests/integration/` convention), do **not** stand up docker/live DBs as part of this
  iteration. Instead: state explicitly in `TESTING.md` that this is an integration-level
  regression check requiring live DB services (ports 15432/13306/11433 per CI), record the exact
  command for the central test runner to execute, and do not mark this checkpoint's manual
  verification as done without it. This is consistent with the ticket's scope boundary — the fix
  itself does not touch the pg/mysql/mssql code path, so the regression check's purpose is
  confirmation, not new coverage of already-adequately-tested dialects.

## Acceptance criteria (verbatim from ticket)

- `noorm db create` on a non-existent SQLite path reports `created: true`; on an existing one,
  `created: false` (test both).
- pg/mysql/mssql `created` semantics unchanged (regression check).
- Ticket 08's skipped SQLite create test (`tests/cli/db/create.test.ts`, the F-1 skip) is
  un-skipped and green.

## Out of scope

- Do not alter `testConnection`'s or `checkDbStatus`'s other responsibilities: server-connectivity
  reporting (`serverOk`), tracking-table detection (`trackingInitialized`), or the non-sqlite
  system-database swap logic in `factory.ts`. `checkDbStatus`'s own signature/behavior does not
  change — only `createDb`'s optional-options threading and its one caller (`create.ts`) do.
- Do not change `createDatabase`/`dropDatabase` for any dialect.
- Do not change `createDb`'s behavior for callers that don't pass `precheckedStatus` — the new
  option is additive and optional; omitting it preserves today's "always call `checkDbStatus`
  internally" behavior exactly.
- Do not fix `db create`'s missing policy gate (flagged separately by ticket 08, tracked
  independently — not this ticket).
- Do not touch ticket 34's SQLite `Date`-vs-string rewind bug — unrelated, different file.
- No new `tests/integration/**` files are required by this spec; if CP3 determines live-DB
  verification is needed, it is recorded for the central runner, not executed here.

## Testing

Environment note: this repo is a **bun** monorepo (never pnpm) despite what `CLAUDE.md`'s
"Changesets" section literally says about workspace package names — that section describes
package naming, not the package manager. All commands below use `bun`.

Run, in this worktree, in order:

1. `bun run build` — `tests/cli/db/create.test.ts` spawns `dist/cli/index.js` as a subprocess;
   the compiled CLI must exist first.
2. `bun run typecheck`
3. `bun run lint`
4. `bun test --serial tests/cli/db/create.test.ts` — the specific file this ticket touches.
5. `bun test --serial tests/cli` — full CLI group (CI group 3), to confirm no adjacent
   regression in the same CI group.

Do not run the full unified `bun test` suite (known cross-file contamination per `CLAUDE.md`) and
do not run `tests/integration` locally — pg/mysql/mssql live-DB verification (if CP3 determines
it's needed) is recorded for the central runner, not executed in this iteration.

## Change log

- 2026-07-12 — initial spec, authored by orchestrator pre-implementation. Stacked on
  `v1/08-dangerous-tests` (`35e19e6`).
- 2026-07-12 — iteration 1 correction: the `checkDbStatus` pre-probe fix alone is necessary but
  not sufficient — `src/cli/db/create.ts` calls `checkDbStatus` a second, independent time before
  `createDb`'s own internal call, and the first call's connectivity-probe side effect (auto-create
  on connect) poisons the second call's pre-probe check. Added the "Root cause — iteration 1
  correction" section above and the `precheckedStatus` threading fix. Discovered by iteration 1's
  implementer via TDD (un-skipped test still failed after the first fix; traced to the double
  invocation rather than guessing a workaround). CP1's file list expanded to include
  `src/core/db/types.ts` and `src/cli/db/create.ts`.
