# SDK routines inside a transaction — `trx.proc` / `trx.func` / `trx.tvf`


## Goal


The handle `ctx.transaction(fn)` passes to `fn` is a Kysely `Transaction<DB>` that also carries typed `proc`, `func`, and `tvf`, running on the transaction's connection, so a caller can issue `SET LOCAL statement_timeout = '8s'` and then a typed `trx.tvf(...)` in one transaction (noormdev/noorm#106).


## Non-goals


- No per-call options bag (`{ statementTimeout }`) on `proc`/`func`/`tvf`.
- No SDK-issued `SET LOCAL` or timeout helper; the caller writes the setting with `sql`.
- No change to `proc`/`func`/`tvf` SQL generation (`src/sdk/sql.ts` builders unchanged).
- No routine methods on `Transaction` instances derived from the handle (`trx.withSchema(...)`, `trx.withPlugin(...)` return plain Kysely instances).
- No nested-transaction support; Kysely's `trx.transaction()` throws as it does today.


## Success criteria


- [ ] `Context.transaction(fn)` calls `fn` with a `TransactionScope<DB, Procs, Funcs, Tvfs>` (= `Transaction<DB> & RoutineCalls<Procs, Funcs, Tvfs>`); a callback annotated `(trx: Transaction<DB>) => …` still type-checks.
- [ ] `trx.proc`, `trx.func`, `trx.tvf` have the same generic signatures as `Context.proc`/`func`/`tvf`, typed off the context's `Procs`/`Funcs`/`Tvfs`.
- [ ] Routine calls through `trx` run on the transaction's connection: a write made by `trx.proc(...)` is rolled back when `fn` throws, verified live on postgres.
- [ ] Postgres: `SET LOCAL statement_timeout = '200ms'` followed by `trx.tvf(...)` of a set-returning function that sleeps 1.5 s rejects with SQLSTATE `57014`; the same call outside the setting returns rows. Verified live.
- [ ] Postgres: inside a transaction, `trx.proc(name)` decides `CALL` vs `SELECT * FROM` with a `pg_catalog.pg_proc` lookup (a `prokind = 'p'` row named `name` in the given schema, or in `current_schemas(false)` when unqualified) before running anything, so no `CALL` is attempted against a name with no visible procedure and no savepoint is issued. Against a FUNCTION it returns the function's rows and leaves the transaction usable for a following statement. Outside a transaction `ctx.proc` behaves as before (try `CALL`, fall back on 42809/42883).
- [ ] Postgres: `Promise.all` over two `trx.proc` calls (one PROCEDURE, one FUNCTION) and a sibling `trx.insertInto(...)` on one handle resolves all three and all three effects commit, verified live.
- [ ] A context from `ctx.withSchema('acct')` qualifies `trx.proc`/`func`/`tvf` names with `acct.` unless the name already contains `.`, same rule as `Context` routines.
- [ ] MSSQL: `trx.tvf(...)` returns rows inside `ctx.transaction`, verified live.
- [ ] `ImpersonatedScope.transaction(fn)` passes the same `TransactionScope` handle; `ImpersonatedScope.proc` uses the shared helper, so it also gets the Postgres FUNCTION fallback.
- [ ] `TransactionScope` and `RoutineCalls` are exported types from `@noormdev/sdk`.
- [ ] `docs/reference/sdk.md`, `docs/dev/sdk.md`, `packages/sdk/README.md`, and `skills/noorm/references/sdk.md` document routines on the transaction handle with the `statement_timeout` example; `.changeset/` carries a `minor` entry for `@noormdev/sdk`.
- [ ] `bun run typecheck`, `bun run lint`, CI test groups 1 and 5 (`docs/wiki/index.md`) pass against `docker-compose.test.yml`.


## Approach

Routine methods attached to the transaction handle — see `docs/design/sdk-transaction-routines.md`.


## Change tree

```
src/sdk/
├── routines.ts ............................ A  (callProc/callFunc/callTvf over any executor; withRoutines)
├── types.ts ............................... M  (RoutineCalls, TransactionScope)
├── context.ts ............................. M  (transaction yields TransactionScope; proc/func/tvf delegate)
├── index.ts ............................... M  (export RoutineCalls, TransactionScope)
└── impersonate/
    ├── scope.ts ........................... M  (delegate to routines.ts; transaction yields TransactionScope)
    └── types.ts ........................... M  (ImpersonatedScope extends RoutineCalls)
tests/sdk/
└── routines.test.ts ....................... A  (unit: attach, qualification, catalog lookup only inside a transaction)
tests/integration/sdk/
└── transaction-routines.test.ts ........... A  (live: pg statement_timeout, rollback, trx.proc against a FUNCTION, concurrency, withSchema; mssql tvf)
docs/reference/sdk.md ...................... M
docs/dev/sdk.md ............................ M
packages/sdk/README.md ..................... M
skills/noorm/references/sdk.md ............. M
.changeset/sdk-transaction-routines.md ..... A
```


## Outline

```
src/sdk/routines.ts
  qualifyName — prefixes an unqualified routine name with the context schema
  routineCalls — binds proc/func/tvf to an executor provider; used by Context, the scope, and withRoutines
  callProc — proc call on a given executor; postgres: catalog lookup picks CALL or SELECT inside a transaction, try-CALL-then-SELECT outside
  callFunc — scalar function call on a given executor, first row or null
  callTvf — table-valued function call on a given executor, all rows
  withRoutines — attaches proc/func/tvf (schema-qualified when a schema is given) to a Kysely Transaction instance, returns it as TransactionScope

src/sdk/types.ts
  RoutineCalls — proc/func/tvf generic signatures keyed off Procs/Funcs/Tvfs
  TransactionScope — Transaction<DB> & RoutineCalls

src/sdk/context.ts
  transaction — opens the Kysely transaction, passes withRoutines(trx, dialect, schema) to fn
  proc / func / tvf — qualify name, delegate to callProc/callFunc/callTvf on this.kysely
  #executeProcPostgres — removed; logic moves to callProc

src/sdk/impersonate/types.ts
  ImpersonatedScope — extends RoutineCalls; transaction yields TransactionScope

src/sdk/impersonate/scope.ts
  buildScope — proc/func/tvf delegate to routines.ts; transaction wraps trx with withRoutines

tests/sdk/routines.test.ts
  handle carries proc/func/tvf and remains the Kysely Transaction
  schema qualification on the handle
  pg_proc lookup issued only when the executor is a transaction; CALL vs SELECT follows its result

tests/integration/sdk/transaction-routines.test.ts
  postgres statement_timeout via SET LOCAL cancels trx.tvf
  routine write rolled back with the transaction
  trx.proc against a FUNCTION runs SELECT and keeps the transaction usable
  withSchema-derived context qualifies trx routines
  mssql trx.tvf returns rows

docs/reference/sdk.md
  transaction() — handle carries proc/func/tvf; statement_timeout example
docs/dev/sdk.md
  Transactions — routines on the handle, SET LOCAL pattern
packages/sdk/README.md
  Transactions — routines on the handle example
skills/noorm/references/sdk.md
  Transactions — trx.tvf with SET LOCAL statement_timeout

.changeset/sdk-transaction-routines.md
  None — frontmatter + summary
```


## Flows

**Routine call under a transaction-scoped setting**

1. Caller calls `ctx.transaction(fn)`.
2. `Context.transaction` opens `this.kysely.transaction()` and receives Kysely's `trx`.
3. `withRoutines(trx, dialect, schema)` assigns `proc`/`func`/`tvf` onto `trx` and returns it typed as `TransactionScope`.
4. `fn` runs `` sql`SET LOCAL statement_timeout = '8s'`.execute(trx) ``, then `trx.tvf(name, params)`.
5. `trx.tvf` qualifies `name` with the context schema (if any), builds the call via `buildTvfCall`, executes it on `trx`, returns rows.
6. `fn` returns; Kysely commits. A throw from `fn` rolls back every statement, routine calls included.

**Postgres `trx.proc` against a FUNCTION**

1. `callProc` sees dialect `postgres` and `db.isTransaction === true`.
2. It queries `pg_catalog.pg_proc` joined to `pg_namespace` for a `prokind = 'p'` row with `proname = name`, in the qualifying schema when `name` is qualified, else in `current_schemas(false)`.
3. A procedure exists: `CALL name(...)`, return rows. Any error propagates (the transaction is the caller's to roll back).
4. No procedure: `SELECT * FROM name(...)`, return rows. A missing name surfaces Postgres's "function does not exist" error, the same final error as outside a transaction.
5. Outside a transaction no lookup runs: `CALL`, and on 42809/42883 `SELECT * FROM`, as before.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Shared routine helpers, `TransactionScope` on `Context.transaction` and `ImpersonatedScope.transaction`, exports, unit + integration tests | `src/sdk/*`, `tests/sdk/routines.test.ts`, `tests/integration/sdk/transaction-routines.test.ts` | atomic-implementer (feature) | 8 | new tests green; existing `tests/sdk`, `tests/integration/sdk` green; typecheck, lint |
| 2 | Docs + changeset | `docs/reference/sdk.md`, `docs/dev/sdk.md`, `packages/sdk/README.md`, `skills/noorm/references/sdk.md`, `.changeset/` | atomic-implementer (feature) | 5 | pages show the `SET LOCAL` + `trx.tvf` example; changeset `minor` for `@noormdev/sdk` |


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Assigning methods onto Kysely's `Transaction` instance collides with a Kysely member | low | Kysely 0.28 `Transaction` has no `proc`/`func`/`tvf` (`fn` is Kysely's and untouched); unit test asserts builder methods still work on the handle |
| One name is both a PROCEDURE and a FUNCTION (overloads in one schema, or across schemas on `search_path`) | low | Any visible procedure routes to `CALL`, so a call meant for the function overload fails inside a transaction where `ctx.proc` outside one would fall back; the lookup matches on name, not arguments. Documented edge |
| Concurrent statements on one handle while `trx.proc` runs | low | No savepoint or multi-statement window exists, so sibling statements cannot be rolled back by `trx.proc`; live `Promise.all` test |
| `statement_timeout` test flakes on a slow CI host | low | 200 ms limit vs 1.5 s sleep leaves a wide margin |


## Change log

### 2026-10-26 — initial spec

**What changed:** Spec created from noormdev/noorm#106.

**Why:** Typed routine calls were unavailable inside `ctx.transaction`, blocking per-call `SET LOCAL statement_timeout`.

### 2026-10-26 — unique savepoint names

**What changed:** The Postgres `trx.proc` savepoint uses a per-call unique name, and a failed `ROLLBACK TO SAVEPOINT` no longer masks the `CALL` error.

**Why:** Iteration 1 review: concurrent `trx.proc` calls on one handle could roll back each other's savepoint under a fixed name.

**Superseded:** One fixed savepoint name shared by every call.

### 2026-10-26 — Correction: serialize savepoint-wrapped proc calls

**What changed:** Savepoint-wrapped `trx.proc` calls on one handle run one at a time, with a live `Promise.all` criterion. A failed rollback skips the fallback and `RELEASE`.

**Why:** Correction: iteration 2 review verified on Postgres 17 that `RELEASE SAVEPOINT noorm_proc_1` destroys a later `noorm_proc_2`, so unique names did not make concurrent calls safe; two concurrent successful calls aborted the transaction.

**Superseded:** Per-call unique savepoint names as the concurrency mitigation.

### 2026-10-26 — Correction: catalog lookup replaces savepoints

**What changed:** Inside a transaction, Postgres `trx.proc` picks `CALL` or `SELECT * FROM` from a `pg_proc` lookup. No savepoints, no per-handle queue, no rollback-error `cause` handling.

**Why:** Correction: a `ROLLBACK TO SAVEPOINT` in the fallback path also undoes any sibling statement the caller ran concurrently on the same handle (`Promise.all([trx.proc(fn), trx.insertInto(...)])`), a silent write loss the queue cannot prevent because it orders only `proc` calls. The lookup was verified live on Postgres 17 against qualified, `search_path`-resolved, quoted-mixed-case, function, and missing names.

**Superseded:** Savepoint-wrapped `CALL` with a per-handle queue of `trx.proc` calls.

### 2026-10-26 — Correction: outline and criterion wording

**What changed:** Outline lists `qualifyName` and `routineCalls` in `src/sdk/routines.ts`; the lookup criterion says no `CALL` is attempted against a name with no visible procedure, instead of "no `CALL` fails"; the change-tree note drops the retired "fallback" wording.

**Why:** Correction: final audit found the outline missing two exports and the criterion contradicting the Risks row (a name that is both a procedure and a function still fails `CALL`).


## Implementation log

### shipped — 2026-10-26

Built across 9 iterations of /autopilot (CP-1: 5, CP-2: 3, post-audit: 1). Commits (chronological):

- `fe6f2181` — spec and design
- `ec25e919` — CP-1 routines on the transaction handle, shared `src/sdk/routines.ts`, unit + live tests
- `dc37fc75` — CP-2 reference, dev guide, SDK README, skill reference, changeset
- `8e07a4bd` — post-audit: `callTvf` reuse, edge-case wording, routing flowchart

**Out-of-scope work performed during this build:**

- `ImpersonatedScope.proc` gained the Postgres FUNCTION fallback by moving onto the shared helper; four pre-existing skill-reference examples used an undeclared `key` and were fixed alongside the new one.

**Unforeseens — surprises that emerged during implementation:**

- The Postgres `CALL`→`SELECT` fallback aborts an open transaction. Savepoints broke concurrent calls (`RELEASE` destroys later savepoints) and could silently roll back a sibling statement; replaced with a `pg_proc` lookup.
- Final audit reproduced that a function earlier on `search_path` wins `CALL` over a same-named procedure; documented as an edge rather than matched.

**Deferred items still open:**

- none

**Squashed into one commit on `sdk-transaction-routines` — 2026-10-26.** Per-iteration SHAs above are historical (unreachable from any branch).
