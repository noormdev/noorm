# Spec: Quote database names in create/drop DDL (all three dialects)

Ticket: `tickets/v1/04-quote-db-names-ddl.md` (v1-blocker, security).
Finding: QL-sec-01, `research/v1-audit/quality-lenses/security.md`.


## Goal


`createDatabase`/`dropDatabase` in `src/core/db/dialects/{postgres,mysql,mssql}.ts` interpolate the unvalidated `dbName` raw into DDL executed against system databases with elevated privileges. A crafted database name (hand-edited config, or brought in via `noorm config import`) can break out of the identifier or string literal and inject arbitrary DDL/DML. Fix: route every identifier through dialect-correct quoting, escape the one MSSQL string literal, and reject dangerous characters in database names at config-save time.


## Layering decision (settled by evidence — do not revisit)


- `src/core` never imports from `src/sdk` (verified: zero `from '../sdk'` hits under `src/core/`). The sdk's private `quoteIdent` (`src/sdk/sql.ts:35-53`) is NOT exported and must not be imported by core.
- Core already has the canonical shared quoting helper: `createDialectQuoting` in `src/core/shared/dialect-quoting.ts`, exported via `src/core/shared/index.ts`, used by all four teardown dialects (`src/core/teardown/dialects/*.ts`) with exactly the close-char-doubling escaping required here.
- Therefore: the db dialects use `createDialectQuoting` from `../../shared/index.js`, mirroring the teardown pattern verbatim. `src/sdk/sql.ts` is untouched.
- Database names are quoted as ONE identifier — no dot-splitting. A name containing `.` stays a single quoted identifier (unlike sdk `quoteIdent`, which splits `schema.name`).


## Contract


### Escaping rules per dialect

| Dialect | Quote style | Escape rule | Example input → quoted |
|---------|-------------|-------------|------------------------|
| postgres | `"name"` | embedded `"` doubled to `""` | `my"x` → `"my""x"` |
| mysql | backtick-wrapped | embedded backtick doubled | `` my`x `` → `` `my``x` `` |
| mssql | `[name]` | embedded `]` doubled to `]]` (`[` needs no escape) | `my]x` → `[my]]x]` |

Configured exactly as the teardown dialects configure it:

    postgres: createDialectQuoting({ open: '"',  close: '"',  escape: '""' })
    mysql:    createDialectQuoting({ open: '`',  close: '`',  escape: '``' })
    mssql:    createDialectQuoting({ open: '[',  close: ']',  escape: ']]' })

### MSSQL string literal

`dropDatabase`'s raw batch keeps its `IF EXISTS(SELECT 1 FROM sys.databases WHERE name = '…') BEGIN … END` structure (byte-identical semantics), but the literal is escaped by doubling embedded single quotes (`'` → `''`). T-SQL string literals have no other escape channel (no backslash escapes), so doubling is complete. The `ALTER DATABASE`/`DROP DATABASE` identifiers inside the batch use bracket quoting per the table above.

### Testable seam

Each of the three dialect files exports pure SQL-builder functions, and the DDL operations execute exactly what the builders return (`sql.raw(build…(dbName)).execute(conn.db)`):

- `buildCreateDatabaseSql(dbName: string): string`
- `buildDropDatabaseSql(dbName: string): string`

This mirrors how teardown dialects expose SQL-generating functions unit-tested as strings (`tests/core/teardown/dialects/*.test.ts`). The already-parameterized statements (`databaseExists` tagged templates, postgres `pg_terminate_backend`) stay tagged-template-parameterized and are NOT converted to builders. New exports carry JSDoc per repo convention.

### Save-time validation (ConnectionSchema)

`ConnectionSchema` (`src/core/config/schema.ts:96-111`) gains a `.refine` on `database`:

- **Applies to:** `postgres`, `mysql`, `mssql`. **Exempt:** `sqlite` (its `database` is a file path, e.g. `:memory:`, `./data/app[1].db`).
- **Rejects** when `database` contains any of: `"` `'` backtick `[` `]` `;` or ASCII control characters (`0x00-0x1F`, `0x7F`).
- **Accepts** everything else, including dots, dashes, spaces, underscores, unicode letters (e.g. `myapp`, `my-app`, `my.app`, `my app`).
- Error message: `Database name must not contain quotes, backticks, brackets, semicolons, or control characters`, issue path `['database']`.
- `PartialConnectionSchema` / `ConfigInputSchema` are unchanged (dialect may be absent in a partial update, so the check cannot be dialect-aware there; full-config validation paths — `parseConfig`, `validateConfig`, `EnvConfigSchema` via `ConfigObjectSchema` — inherit the refine).

Defense-in-depth ordering: quoting is the actual fix; the schema check exists so garbage fails at save time with a good message instead of at DROP-DATABASE time.


## Checkpoints


| CP | Deliverable | Proof |
|----|-------------|-------|
| CP-1 | Per-dialect SQL builders with correct escaping; `createDatabase`/`dropDatabase` in all three dialect files route through them | New unit tests `tests/core/db/dialects/{postgres,mysql,mssql}.test.ts` written red-first, then green. Adversarial names containing `"`, backtick, `]`, `'`, and `;`-payloads assert exact escaped output (no breakout) |
| CP-2 | `ConnectionSchema` database-name format check | New cases in `tests/core/config/schema.test.ts`: rejects each dangerous char per server dialect; accepts normal names; sqlite paths unaffected |


## Acceptance criteria (ticket, verbatim)


- Per-dialect tests: a database name containing `"` / `` ` `` / `]` / `'` cannot break out of the identifier (statement is correctly escaped or rejected).
- Normal create/drop flows still pass integration tests.


## Evidence


- `src/core/db/dialects/postgres.ts:70` — `CREATE DATABASE "${dbName}"` raw
- `src/core/db/dialects/postgres.ts:88` — `DROP DATABASE IF EXISTS "${dbName}"` raw
- `src/core/db/dialects/mysql.ts:66` — CREATE DATABASE IF NOT EXISTS backtick-interpolated raw
- `src/core/db/dialects/mysql.ts:76` — DROP DATABASE IF EXISTS backtick-interpolated raw
- `src/core/db/dialects/mssql.ts:70` — `CREATE DATABASE [${dbName}]` raw
- `src/core/db/dialects/mssql.ts:81-91` — `WHERE name = '${dbName}'` + `ALTER/DROP [${dbName}]` inside one `sql.raw` batch
- `src/core/config/schema.ts:101` — `database: z.string().min(1)` (no format check)
- `src/sdk/sql.ts:35-53` — correct escaping pattern (private to sdk; pattern reference only)
- `src/core/shared/dialect-quoting.ts` — canonical core quoting helper (the mechanism this fix routes through)


## Out of scope


- General `.sql.tmpl` template-injection surface (audited separately; not this ticket).
- Consolidating `src/sdk/sql.ts`'s private `quoteIdent` onto the shared helper (sdk untouched).
- `src/core/db/dialects/sqlite.ts` (file operations, no DDL interpolation).
- Partial-update validation (`PartialConnectionSchema`) — see Contract.
- TOCTOU races between exists-check and create/drop (pre-existing pattern, unchanged).
- Other v1-audit findings (QL-sec-02 … QL-sec-06).


## Test commands (scoped — per centralized-testing protocol)


- Unit (this task): `bun test tests/core/db/dialects/ tests/core/config/schema.test.ts`
- `bun run typecheck` and `bun run lint`
- Integration (central runner only, NOT run by this loop): `bun test --serial tests/integration` with docker services up (`docker compose up -d`, ports 15432/13306/11433) — covers normal create/drop flows (`tests/integration/cli/db.test.ts`, `tests/integration/sdk/db-reset.test.ts`).


## Change log


- 2026-07-12 — initial spec (from ticket 04 + QL-sec-01). Centralized-testing amendment applied: integration verification owned by central runner.
