# Spec: Default-on test-database guard for the integration suite

Ticket: 18 — Default-on test-database guard (finding QL-safe-06, research/v1-audit/quality-lenses/destructive-safety.md).


## Goal

Every integration test that connects through `createTestConnection` (`tests/utils/db.ts`) must fail loudly BEFORE any statement runs when the resolved target database does not look like a test database. Today the `TEST_*` env vars flow into `createConnection` with zero runtime validation — a stray `.env`, a leaked CI secret, or a copy-pasted production env file points the destructive suite (teardown/truncate/drop) at a real database with nothing in the code path to stop it.

The existing guard (`checkRequireTest` in `src/sdk/guards.ts:79-90`) decides "is a test database" via the declared `Config.isTest` flag. `createTestConnection` holds only a `ConnectionConfig`, which has no `isTest` field and no `Config` wrapper — so the flag-based guard cannot apply here. The ticket's sanctioned alternative applies instead: a database-name-convention assertion, defined once in the test harness (single source of truth for the convention rule).


## Contract

### New: `NotATestDatabaseError` in `tests/utils/db.ts`

Named error class following the `src/sdk/guards.ts` idiom (`override readonly name = 'NotATestDatabaseError' as const;`, public readonly fields). Producers throw named errors and let them propagate — no try-catch, no `attempt()` wrapping in the throw path (project ruling D1).

Message MUST contain, in one clear sentence group:

- the dialect and the resolved database name (or `"(unset)"` when undefined/empty),
- the convention that failed (database name must be `:memory:` or contain `test` as a `_`/`-`-delimited word),
- the remediation (`set TEST_<DIALECT>_DATABASE to a dedicated test database, e.g. "noorm_test"`).

Reference shape (wording may vary, content may not):

    Refusing to connect: postgres database "prod_analytics" does not look like a
    test database. The test suite runs destructive operations (truncate, teardown,
    drop). Use a database whose name is ":memory:" or contains "test" as a word
    (e.g. "noorm_test"), or fix TEST_POSTGRES_DATABASE.

### New: `assertTestDatabase(config: ConnectionConfig): void` exported from `tests/utils/db.ts`

The single source of truth for the convention. Throws `NotATestDatabaseError` unless the resolved `config.database`:

- is the string `:memory:` (sqlite in-memory), OR
- matches `/(^|[_-])test([_-]|$)/i` — `test` as a word delimited by string boundaries, `_`, or `-`.

`undefined`, empty string, or any non-matching name throws. Pure synchronous validation — no I/O, no network.

### Changed: `createTestConnection` in `tests/utils/db.ts`

Calls `assertTestDatabase(config)` as its validation block, before `createConnection` is invoked. On a non-test-looking target the error propagates before any connection attempt (no retry delay, no `SELECT 1`, no statement runs).

### What passes / what fails

| Resolved database | Verdict |
|---|---|
| `noorm_test` (default, CI) | pass |
| `noorm_test_dest` (transfer dest, CI) | pass |
| `:memory:` (sqlite) | pass |
| `test`, `my_test_db`, `TEST-DB` | pass |
| `production`, `noorm`, `analytics` | throw `NotATestDatabaseError` |
| `attestation`, `contest`, `testdata`, `mytestdb` (embedded, not word-delimited) | throw |
| `undefined`, `''` | throw |

### No escape hatch

`checkRequireTest` defines no bypass env var, so this guard adds none. A legitimately non-conforming local setup renames its test database or sets `TEST_<DIALECT>_DATABASE` — the failure is loud and self-explanatory.


## Tests (TDD — failing test first)

New file `tests/utils/db-guard.test.ts`, bun:test, `describe('utils: assertTestDatabase')` / `describe('utils: createTestConnection guard')` naming per `.claude/rules/testing.md`. Error assertions via `attempt`/`attemptSync` from `@logosdx/utils` — never try-catch.

1. Rule accepts: `noorm_test`, `noorm_test_dest`, `:memory:`, `test`, `my_test_db`, case-insensitive variants.
2. Rule rejects: `production`, `noorm`, `attestation`, `contest`, `testdata`, `undefined`, `''` — error is `NotATestDatabaseError`, message names the database, the convention, and the `TEST_*_DATABASE` remediation.
3. `createTestConnection` throws `NotATestDatabaseError` (not a connection error) when `TEST_CONNECTIONS.postgres.database` is a non-test-looking name. NOTE: `TEST_CONNECTIONS` snapshots `process.env` at module load — the test MUST mutate the exported `TEST_CONNECTIONS` object and restore it in `beforeEach`/`afterEach` hooks, not set env vars. The throw must be fast (guard fires before the connect/retry path — no docker required for this test).
4. Happy path without docker: `createTestConnection('sqlite')` resolves (`:memory:` passes the guard) and `destroy()` completes.
5. Happy path convention: the default `TEST_CONNECTIONS` entries for all four dialects satisfy `assertTestDatabase` (loop, expect no throw).

All five run in CI group 1 (`tests/utils`) with no live database.


## Checkpoints

| # | Checkpoint | Done when |
|---|---|---|
| CP-1 | Guard + wiring + tests | `tests/utils/db-guard.test.ts` green; `bun run typecheck` green; `bun run lint` green; `tests/utils/db.ts` is the only non-test file touched |


## Acceptance criteria (ticket, verbatim)

- `createTestConnection` against a database not matching the test convention throws with a clear message (test).
- Existing integration suite still passes against the docker-compose services.

The second criterion is central-verification scope: because this changes the shared integration-test connection helper, full verification MUST include CI group 4 (`bun test --serial tests/integration`) against live docker services (ports 15432/13306/11433) to prove the guard does not false-positive on the legitimate CI configuration. Implementer iterations run only the touched test files + typecheck + lint (see `.claude/.scratchpad/2026-07-12-v1-18/TESTING.md`).


## Out of scope

- Production `requireTest` behavior unchanged — `src/sdk/guards.ts` and everything under `src/**` untouched.
- CI workflow files untouched.
- Direct `TEST_CONNECTIONS` consumers that build their own configs (transfer dest configs, `tests/global-setup.ts`'s `master` connection for MSSQL bootstrap) are not gated by this seam — known limitation, out of scope.
- No new bypass/escape-hatch env var.


## Change log

- 2026-07-12 — initial spec from ticket 18 + QL-safe-06 evidence.
