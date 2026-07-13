# Spec: SQLite rewind crash — history rows return string dates

- ticket: tickets/v1/34-sqlite-rewind-date-crash.md (v1-blocker, effort S-M)
- finding: F-1 (discovered and repro-verified during ticket 01 implementation; see "Discovered blocker" in docs/spec/v1-01-rewind-exit.md)
- branch: `v1/34-sqlite-rewind-date`
- **stacked base: `v1/01-rewind-exit`** (not master) — the partial-exit-2 test this ticket un-skips was authored on that branch and only exists there. This diff is reviewed against `v1/01-rewind-exit`'s HEAD (`4c4b198`), not master. If `v1/01-rewind-exit` merges to master first, this branch stays valid (its base is a strict ancestor of master post-merge).

## Goal

`noorm change rewind` crashes on SQLite whenever ≥2 changes are applied. `ChangeManager.rewind()`'s sort comparator (`src/core/change/manager.ts:371-372`) calls `a.appliedAt?.getTime()`, but `ChangeHistory` (`src/core/change/history.ts`) returns the `executed_at` column verbatim from the driver at 6 read sites across 4 methods, and only 3 of 4 dialects' drivers happen to auto-parse that column into a `Date`. SQLite hands back a raw string. The declared type (`ChangeStatus.appliedAt: Date | null`, `types.ts:140`) is a lie under SQLite, and the sort throws `TypeError: a.appliedAt?.getTime is not a function` before `rewind()` computes any status — breaking real (non-test) `noorm change rewind` in production, independent of ticket 01.

Fix at the history-adapter boundary: make `ChangeHistory`'s date-typed reads always return a real `Date`, regardless of dialect, so the declared types stop lying.

## Evidence (re-verified against worktree source at HEAD `4c4b198`)

**The single underlying column.** All date-typed fields below resolve to one DB column, `change.executed_at` — there is no separate `reverted_at` column. `revertedAt` is derived by querying a second row (`direction: 'revert'`, `status: 'success'`) and reading that row's `executed_at`. The `__noorm_executions__` table (file-level history) has no date column at all — `FileHistoryRecord` has no Date field, nothing to fix there.

**DDL.** `src/core/version/schema/migrations/v1.ts:46-50,88-90` — one dialect-branching helper, `timestampType(dialect)`, emits `'timestamp'` for sqlite/postgres/mysql and `sql\`datetime2\`` for mssql, with `.defaultTo(sql\`CURRENT_TIMESTAMP\`)`. Kysely's schema compiler renders the generic `'timestamp'` string verbatim (no dialect-specific type mapping) — so SQLite's column gets NUMERIC storage affinity (no fixed type; `'timestamp'` doesn't match SQLite's TEXT/INT/BLOB/REAL affinity rules).

**Write side.** `src/core/change/history.ts:394-411` (`createOperation`) and `:728-743` (`recordReset`) never supply `executed_at` in `.values({...})` — it's populated entirely by the DDL default (`CURRENT_TIMESTAMP`). No app-level `new Date()` anywhere on the write path.

**Read side — driver behavior per dialect** (`src/core/connection/dialects/{sqlite,sqlite-bun,postgres,mysql,mssql}.ts`; no type parsers, `dateStrings` options, or Kysely plugins registered anywhere in the connection layer for dates — confirmed by grep):

| Dialect | Driver | `executed_at` on SELECT |
|---|---|---|
| sqlite (Bun) | `bun:sqlite`, hand-wrapped `BunSqliteDatabase` (`sqlite-bun.ts`) | raw string, e.g. `'2026-07-12 09:02:59'` |
| sqlite (Node) | `better-sqlite3`, unwrapped into Kysely's stock `SqliteDialect` (`sqlite.ts`) | same raw string shape (SQLite server-side `CURRENT_TIMESTAMP` format, driver-independent) |
| postgres | `pg` | real `Date` (pg's default OID-1114 text parser, `postgres-date`) |
| mysql | `mysql2` | real `Date` (default; no `dateStrings` opt set) |
| mssql | `tedious` | real `Date` (standard `DateTime2` type handler) |

Empirically confirmed (this session, `bun -e` against `bun:sqlite`, system TZ `America/New_York`, UTC offset -240min):

```
raw row: {"ts":"2026-07-12 09:02:59"}   typeof === 'string'
new Date(raw)                    -> 2026-07-12T13:02:59.000Z   WRONG (+4h — parsed as local time)
new Date(raw.replace(' ','T')+'Z') -> 2026-07-12T09:02:59.000Z   CORRECT (matches raw UTC value)
```

**This is the critical gotcha the fix must not reintroduce as a silent correctness bug**: SQLite's `CURRENT_TIMESTAMP` is UTC text in `'YYYY-MM-DD HH:MM:SS'` form (no `Z`, no offset). Handing that string to `new Date(str)` directly makes the JS engine parse it as **local time**, silently shifting every hydrated timestamp by the host's UTC offset. The hydration must explicitly mark the string as UTC before parsing (e.g. `new Date(`${value.replace(' ', 'T')}Z`)`), not rely on `new Date(value)`.

**All 6 read sites in `src/core/change/history.ts` that need hydration** (all trace to `change.executed_at`):

| Method | Field | Read site | Declared type |
|---|---|---|---|
| `getStatus` | `appliedAt` | `history.ts:172` (`record.executed_at`) | `ChangeStatus.appliedAt: Date \| null` (`types.ts:140`) |
| `getStatus` | `revertedAt` | `history.ts:174` (`revertRecord?.executed_at ?? null`) | `ChangeStatus.revertedAt: Date \| null` (`types.ts:146`) |
| `getAllStatuses` | `appliedAt` | `history.ts:223` (`record.executed_at`) | `ChangeListItem.appliedAt: Date \| null` (`types.ts:208`) |
| `getAllStatuses` | `revertedAt` | `history.ts:256` (`revert.executed_at`) | `ChangeListItem.revertedAt: Date \| null` (`types.ts:214`) |
| `getHistory` | `executedAt` | `history.ts:911` (`r.executed_at`) | `ChangeHistoryRecord.executedAt: Date` (`types.ts:461`) |
| `getUnifiedHistory` | `executedAt` | `history.ts:984` (`r.executed_at`) | inherits `ChangeHistoryRecord.executedAt` |

**No existing hydration helper anywhere in the codebase** (grepped `src/` for `hydrateDate|parseDate|toDate|coerceDate|normalizeDate|reviveDate` — zero matches; the only Kysely plugin in the repo, `MssqlLimitPlugin`, has a no-op `transformResult`). This is new code, not a reuse case.

**The crash site** (unchanged by this ticket, cited for context): `src/core/change/manager.ts:365-376`, `rewind()`'s sort comparator calls `a.appliedAt?.getTime()` / `b.appliedAt?.getTime()` on the `ChangeListItem[]` returned by `this.list()` (which is backed by `getAllStatuses()`).

## Prescription

In `src/core/change/history.ts` only:

1. Add a module-private `hydrateDate(value: Date | string | null | undefined): Date | null` helper. Contract:
   - `null`/`undefined` in → `null` out.
   - Already a `Date` → returned unchanged (pg/mysql/mssql pass-through, zero cost).
   - A string → parsed as UTC per the SQLite `CURRENT_TIMESTAMP` shape (`'YYYY-MM-DD HH:MM:SS'`), not handed to `new Date(str)` naively (see the UTC gotcha above).
2. Apply `hydrateDate` at all 6 read sites in the table above (`getStatus` ×2, `getAllStatuses` ×2, `getHistory` ×1, `getUnifiedHistory` ×1).
3. No DDL change, no write-side change, no change to `manager.ts` (the sort logic is correct once its input is honest — ticket 01's scope boundary already forbids touching `manager.ts`/`executor.ts`).

## Test construction notes (verified against source — do not improvise)

Two new test files, mirroring the existing `tests/core/change/executor.test.ts` in-memory harness pattern (in-memory `bun:sqlite` via `BunSqliteDatabase`, `Kysely<NoormDatabase>`, bootstrapped with `v1.up(db, 'sqlite')` — no live DB, no docker):

**`tests/core/change/history.test.ts`** (new — mirrors `src/core/change/history.ts`, no existing file to extend):

- Pure-function table test for `hydrateDate` covering the 3 representative dialect shapes: sqlite raw string (assert exact UTC value, not just `instanceof Date` — must catch the local-time-parsing regression specifically, using the empirically-verified pair `'2026-07-12 09:02:59'` → `2026-07-12T09:02:59.000Z`), a `Date` object (pg/mysql/mssql shape — pass-through, identity preserved), and `null`.
  - If `hydrateDate` isn't exported, test it indirectly through `ChangeHistory` methods with a controlled raw value — but a pure function is cheaper and more precise to pin the UTC-parsing edge case directly; exporting it (or a same-file test-only export) is preferred. Use judgment; either satisfies "type-boundary test... fails if an adapter returns a string again" as long as the UTC-correctness assertion survives.
- Integration-shaped test against the real in-memory `bun:sqlite` driver: create a `ChangeHistory`, run `createOperation` + `finalizeOperation` for two operations, then assert `getStatus(...).appliedAt`, `getAllStatuses().get(...).appliedAt`, `getHistory()[...].executedAt`, and `getUnifiedHistory()[...].executedAt` are all `instanceof Date` (this is the assertion that fails today, pre-fix, proving the repro against the real driver — not a mock).

**`tests/core/change/manager.test.ts`** (new — mirrors `src/core/change/manager.ts`, no existing file):

- The ticket's literal repro: in the same in-memory harness, execute two real changes (`executeChange` + `history.createOperation`/`finalizeOperation`, or via `ChangeManager.run()` if that's less setup — implementer's call), then call `ChangeManager.rewind()`. Pre-fix this throws `TypeError: a.appliedAt?.getTime is not a function`; post-fix it must return a `BatchChangeResult` with a `status` (`'success' | 'partial' | 'failed'`) instead of throwing. This is CP-1's independent verification and the closest unit-level mirror of the CLI e2e repro.
- Do not assert a specific status value beyond "did not throw and returned a well-formed result" unless the scenario is built to produce a specific one — that's ticket 01's already-tested territory (partial-status construction is covered by the CLI e2e test below). Keep this test scoped to "the sort doesn't crash," matching this ticket's scope boundary.

**Un-skip** (existing file, authored on `v1/01-rewind-exit`, not touched by this ticket until now): `tests/cli/run/change-rewind.test.ts:72`, change `it.skip(...)` to `it(...)`. The skip-rationale comment at lines 62-71 explains a bug that is fixed as of this ticket — delete it (a stale "why this is skipped" comment left in place after the skip is removed is actively misleading, not neutral). No other change to that file; the test body (lines 73-100) was authored against a verified recipe in ticket 01 and needs no edits, only the fix in `history.ts` for it to pass.

## Checkpoints

| # | Checkpoint | Independently verifiable by |
|---|---|---|
| CP-1 | `tests/core/change/manager.test.ts` (new): `ChangeManager.rewind()` with 2 applied SQLite changes computes a result instead of throwing `TypeError` — the ticket's literal repro, failing before the fix | `bun test tests/core/change/manager.test.ts` |
| CP-2 | `tests/core/change/history.test.ts` (new): `hydrateDate` (or equivalent) pins Date hydration for all 3 representative dialect shapes (sqlite string incl. UTC-correctness, Date pass-through, null), plus an integration-shaped assertion against the real `bun:sqlite` driver that `getStatus`/`getAllStatuses`/`getHistory`/`getUnifiedHistory` all return `Date` instances | `bun test tests/core/change/history.test.ts` |
| CP-3 | `src/core/change/history.ts`: all 6 read sites (`getStatus` ×2, `getAllStatuses` ×2, `getHistory` ×1, `getUnifiedHistory` ×1) route through the hydration helper; no DDL/write-side/`manager.ts`/`executor.ts` changes | read the diff |
| CP-4 | `tests/cli/run/change-rewind.test.ts`: partial-exit-2 test un-skipped (line 72, `it.skip` → `it`), stale skip-rationale comment (lines 62-71) removed, green end-to-end against the compiled CLI | `bun run build && bun test tests/cli/run/change-rewind.test.ts` |
| CP-5 | Typecheck and lint green | `bun run typecheck && bun run lint` |

## Acceptance criteria (ticket, verbatim)

- Rewind with ≥2 applied changes on SQLite computes status instead of crashing (the repro passes).
- The skipped partial-exit-2 test is un-skipped and green.
- A type-boundary test pinning Date hydration per dialect adapter (fails if an adapter returns a string again).

## Out of scope

- Rewind's business logic, status derivation, and exit codes — ticket 01's already-done work (`src/cli/change/rewind.ts`, the `status === 'success' ? 0 : 2` mapping, `manager.ts`'s partial/failed/success derivation at line ~486). This ticket touches `manager.ts` not at all — the sort at `manager.ts:369-376` needs no change once its input is honest.
- `src/core/change/executor.ts` — untouched.
- Any DDL/migration change (`src/core/version/schema/migrations/v1.ts`) — the fix is read-side hydration only; the column stays `timestamp`/`datetime2` in storage.
- Date columns outside `src/core/change/history.ts` — the ticket's audit boundary is explicitly "the same file." Other domains (settings, identity, vault, lock) are not audited here; if this investigation surfaces the same class of drift elsewhere, it is reported as a new finding, not fixed in this diff.
- Live-DB (postgres/mysql/mssql) integration confirmation — those 3 dialects already return real `Date`s per verified driver defaults (Evidence section); this ticket "pins" that behavior via the unit-level table-driven test in CP-2 rather than a live-DB integration test. `tests/integration/**` and docker are out of scope per the centralized testing protocol; if a future integration run wants to additionally confirm this against live postgres/mysql/mssql containers, that's the central runner's call, not this ticket's.
- `ChangeAlreadyAppliedError` (`types.ts:620-633`) — takes a `Date` constructor arg and calls `.toISOString()`; grepped for call sites, found none (dead code). Not touched.

## Change log

- 2026-07-12 — initial spec from ticket 34 + the "Discovered blocker" section of docs/spec/v1-01-rewind-exit.md, all evidence re-verified against worktree source at HEAD `4c4b198` (branch `v1/01-rewind-exit`, stacked base for this ticket). UTC-parsing gotcha for SQLite's `CURRENT_TIMESTAMP` empirically verified via `bun -e` against `bun:sqlite` in this session.
