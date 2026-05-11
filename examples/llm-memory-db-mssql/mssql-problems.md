# noorm MSSQL — Problems Report

Issues surfaced while building `examples/llm-memory-db-mssql/` against MSSQL 2022 (port 11433, SA login). Each entry records the exact reproduction, expected vs. actual behaviour, the workaround applied to keep moving, and a hypothesis about where the fix belongs in `noorm`.

The exercise ran on `noorm v1.0.0-alpha.34` against `mcr.microsoft.com/mssql/server:2022-latest`. Schema: 38 tables, 18 views, 72 procedures, 14 functions, 4 TVP types. Test suite: 223 passing across 24 files (Phase 1: 194; Phase 2 review loop added 29 more, including the MCP-discovery meta-test).


## 1. `noorm init` requires a TTY with no non-interactive escape hatch

**Severity:** medium — blocks fully scripted bootstrap (CI, subagents).

**Repro:**

    $ cd examples/llm-memory-db-mssql
    $ bun init -y
    $ noorm init --force
    Error: noorm init requires an interactive terminal.
    $ noorm init --help
    USAGE  noorm init [OPTIONS]
    OPTIONS
      -f, --force    Force operation

**Expected:** A non-interactive flag (`--name`, `--email`, `--use-existing-identity`, `--yes`) so the project can be bootstrapped from a script. The `noorm` CLI already has the existing identity at `~/.noorm/identity.{key,pub,json}` — there is nothing genuinely interactive that needs prompting.

**Actual:** Hard refusal whenever stdin is not a TTY. No env var (`NOORM_YES=1`, `NOORM_HEADLESS=1`) overrides it. `< /dev/null` redirection does not help. Subagents fail every time.

**Workaround:** The user typed `! noorm init --force` interactively in the Claude Code prompt to inherit the parent shell's TTY.

**Suggested fix:** Honour `NOORM_YES=1` (already documented as a behaviour env var) when an identity already exists, defaulting all the bootstrap questions. Alternatively add `--non-interactive` and `--name`/`--email` overrides to `noorm init`.

**Status:** Partially addressed by `--yes` / `NOORM_YES` for `noorm init`. With an existing identity at `~/.noorm/identity.{key,pub,json}`, `noorm init --yes` now bootstraps without prompting. Missing identity errors with a hint pointing at `noorm identity init --name ... --email ...`. See `docs/guide/automation/non-interactive.md`. Cross-referenced from `docs/guide/troubleshooting.md` for discovery.


## 2. `noorm config add` is TUI-only

**Severity:** medium — same blast radius as #1; users learn to reach for `import` instead.

**Repro:**

    $ noorm config add --help
    USAGE  noorm add
    EXAMPLES
      noorm ui  # then navigate to config > add

The CLI literally tells you to launch the TUI. `noorm config edit` and `noorm config rm` are similarly TTY-only.

**Workaround:** Author the config as JSON and use the documented `noorm config import <path>` (which is non-interactive). The shape required is the `Config` interface from `references/config.md` — `name`, `connection.{dialect,host,port,database,user,password}`, `isTest`, `protected`. A `stage` field is also accepted.

**Suggested fix:** Promote `config import` in CLI help/examples for scripted setup, or add `--from-stage <stageName>` and `--name <name>` flags to `config add` so it can build the config from `settings.yml` defaults without prompting.

**Status:** Still TUI-only. `noorm config add --yes` is out of scope for the `--yes` slice (the command redirects to the TUI rather than gating on a TTY). Use `noorm config import <path>` for scripted setup — that path is fully non-interactive. The configs-first workflow (including `config import`) is now documented in `docs/guide/database/create.md`.


## 3. Schema runner does not split MSSQL `GO` batches

**Severity:** **high** — this is the issue most likely to surprise other MSSQL users.

**Repro:**

    -- sql/00_types/01_TagAttachmentInput.sql
    CREATE TYPE [dbo].[TagAttachmentInput] AS TABLE (
        [tag_id]    INT NOT NULL,
        [entity_id] INT NOT NULL
    );
    GO

    $ noorm run build
    Build completed successfully  status=failed filesRun=0 filesFailed=1

    $ noorm sql -f sql/00_types/01_TagAttachmentInput.sql
    Error: Query failed: Incorrect syntax near 'GO'.

**Expected:** `GO` is the canonical T-SQL batch separator; sqlcmd, SSMS, Azure Data Studio and every reasonable MSSQL deployment tool understands it. The runner should split on `^\s*GO\s*$` for MSSQL files before sending each batch to tedious.

**Actual:** `src/core/runner/runner.ts` lines 910 and 1090 do `sql.raw(sqlContent).execute(context.db)` which feeds the whole file to tedious. Tedious treats `GO` as SQL and rejects it. The runner reports `(failed)` and moves on.

The repo is aware of this — `tests/utils/db.ts:391` ships a private `splitMssqlBatches()` helper for the integration suite that does exactly this regex split. The schema build pipeline doesn't use it.

**Why this matters:** Several T-SQL DDL statements **must be the only statement in their batch**: `CREATE PROCEDURE`, `CREATE FUNCTION`, `CREATE TRIGGER`, `CREATE VIEW`, `CREATE TYPE` (with TVP table types). Without `GO` you cannot put two such statements in the same file. With this gap I had to split every multi-procedure file into one-statement files (~73 separate files for the procedure bucket alone). That works but it scatters domain code that should live together.

**Workaround:** All `.sql` files in this example contain exactly one CREATE statement; the proc bucket has 73 files instead of the natural 13 grouped-by-domain files. A small `tmp/split-procs.ts` script handled the migration. No `GO` appears anywhere in `sql/`.

**Suggested fix:** Lift `splitMssqlBatches()` into `src/core/runner/runner.ts` and call it for `dialect === 'mssql'`. Optionally allow other dialects' batch separators (PostgreSQL doesn't have one; MySQL has `DELIMITER //` for procs, which is a different problem).

**Status:** Fixed in worktree branch `worktree-noorm-fixes` (commit shows in `git log`). The runner now imports `splitMssqlBatches` from `src/core/runner/mssql-batches.ts` and feeds batches one at a time to tedious when `dialect === 'mssql'`. Multi-batch failures surface as `[batch N of M] <driver error>` in `FileResult.error`. The original workaround (one `CREATE` per file) is no longer needed but this example hasn't been re-consolidated — that's a follow-up.


## 4. Build/run failures are silent — no error detail in stdout, stderr, or `--json`

**Severity:** **high** — turns every schema bug into a guessing game.

**Repro:**

    $ noorm run build
    Build completed successfully  status=failed filesRun=43 filesFailed=1
    $ noorm --json run build 2>&1 | grep -i error
    (no output)
    $ noorm run file sql/00_types/01_TagAttachmentInput.sql
    /Users/.../sql/00_types/01_TagAttachmentInput.sql (failed)
    $ noorm --json run file sql/00_types/01_TagAttachmentInput.sql 2>&1 | tail -1
    /Users/.../sql/00_types/01_TagAttachmentInput.sql (failed)

The build claims `Build completed successfully` while `status=failed`. `--json` adds no error string. The `noorm.log` file in `.noorm/state/` does not capture the underlying database error either.

**Expected:** When `filesFailed > 0`, the JSON envelope (and structured logger) should include `{ filename, error: { code, message, lineNumber } }` for every failed file. `noorm run file` should include the same under `error` even when execution fails.

**Actual:** The only way to find out which file failed is to scan stdout for the order in which `file:after` events fired and infer the next one. The only way to see the SQL error is to fall back to `noorm sql -f <path>` (which executes the file as a single batch and surfaces tedious's exception). That sql-fallback only works for files without `GO` (see #3) — a chicken-and-egg if the failure was caused by a `GO`.

**Suggested fix:** Capture the tedious `RequestError` in the runner's `attempt()` block at `runner.ts:910`/`:1090` and propagate it through the `FileResult` and `BatchResult` types. Make `--json run build` emit `{ status, filesRun, filesFailed, files: [{ filepath, status, error?: { code, message } }] }`.


## 5. `db.reset()` drops tables before functions; schema-bound UDFs block the table drop

**Severity:** medium — affects the documented test bootstrap pattern (`db.reset()` in `beforeAll`).

**Repro:**

    // tests/helpers/test-context.ts (the SDK's recommended pattern)
    beforeAll(async () => {
        ctx = await createContext({ config: 'test', requireTest: true });
        await ctx.connect();
        await ctx.noorm.db.reset();
    });

    Error: Cannot DROP TABLE 'dbo.Memory' because it is being referenced
    by object 'fn_MemoryConfidence'.

**Expected:** Teardown should drop dependent objects (functions, views, procedures, triggers) before tables. Currently `src/core/teardown/operations.ts` drops in this order: foreign keys → views → tables → functions → procedures → types. The functions step is too late.

**Actual:** Schema-bound UDFs (`WITH SCHEMABINDING`) acquire a hard dependency lock on the tables they reference. MSSQL refuses to drop the table until the function is gone. The teardown halts at the first such conflict and leaves the database in a half-dropped state.

This is unavoidable for schema-bound functions in this design — the validators in `sql/03_validators/` *must* be schema-bound so the inline `CHECK (dbo.fn_X(...) = 1)` constraints on subtype tables can reference them. Removing schema-binding to satisfy the teardown order would defeat the whole point of declaring the constraints inline.

**Workaround:** Avoid `db.reset()` in tests. Use `db.truncate()` for per-suite cleanup (which has its own problem — see #6) and run `noorm run build` once manually before the suite.

**Suggested fix:** Reorder teardown so functions and procedures are dropped *before* tables. The current order seems to assume FKs are the only inter-object dependency; for MSSQL that's not true.

**Status:** Fixed. Teardown now drops in `FK → Procedures → Functions → Views → Tables → Types` order, so schema-bound UDFs release their dependency locks before `DROP TABLE` runs. See `docs/dev/teardown.md#drop-order`.


## 6. `db.truncate()` deadlocks on `sp_MSforeachtable`

**Severity:** **high** — makes the documented per-test cleanup pattern unusable on a non-trivial schema.

**Repro:** Any test file that calls `await ctx.noorm.db.truncate()` in `beforeEach` against this 38-table schema will eventually fail with:

    error: Transaction (Process ID 56) was deadlocked on lock resources
    with another process and has been chosen as the deadlock victim.
    Rerun the transaction.
       procName: "sys.sp_MSforeach_worker"
       lineNumber: 151

The deadlock is intermittent — some runs succeed, some fail at a random table. With 23 test files calling `truncate()` in beforeEach, every full-suite run had ≥10 failures from this alone.

**Expected:** A `truncate()` operation on a single connection from a test process should never deadlock with itself.

**Actual:** `src/core/teardown/dialects/mssql.ts` uses `EXEC sp_MSforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL'` (and the inverse). `sp_MSforeachtable` is undocumented but well-known to spawn parallel worker tasks under the hood. Those workers acquire schema locks across many tables in different orders and deadlock against each other (or against any concurrent query in the same transaction scope).

**Workaround:** Wrote a `resetApplicationData(ctx)` helper in `tests/helpers/test-context.ts` that issues `DELETE FROM [dbo].[<table>]` for each application table in explicit FK order over a single connection. Reference tables stay preserved (matching `settings.yml > teardown.preserveTables`) and sentinel rows are re-seeded at the end. With this helper, the same suite goes from ~10 deadlocks per run to zero.

**Suggested fix:** Replace `sp_MSforeachtable` with explicit, ordered DELETE statements driven from the FK graph the SDK already discovers (it ships `db.listForeignKeys()` for exploration). For full teardown, dropping in dep-graph order is the only safe approach.

**Status:** Fixed. `db.truncate()` now emits per-table `ALTER TABLE NOCHECK CONSTRAINT ALL` / `DELETE FROM` / `ALTER TABLE CHECK CONSTRAINT ALL` statements on a single connection — no `sp_MSforeachtable`, no parallel workers. The hand-rolled `resetApplicationData(ctx)` helper in this example can be deleted; `ctx.noorm.db.truncate()` is now safe to call from `beforeEach` against this schema. See `docs/dev/teardown.md#mssql-truncate-strategy`.


## 7. `noorm.run.file()` skips by checksum even after `truncate()` wiped the rows

**Severity:** medium — discoverable but the failure mode (silent skip) is hard to spot.

**Repro:**

    beforeEach(async () => {
        await ctx.noorm.db.truncate();   // wipes Agent + Project (sentinels gone)
        await ctx.noorm.run.file('sql/06_seeds/11_Sentinels.sql.tmpl');
        // ↑ silently no-ops — checksum row in __noorm_* says "already ran"
    });

    // First test:
    Error: The INSERT statement conflicted with the FOREIGN KEY constraint
    "FK_Memory_Project". The conflict occurred in database "noorm_llm_test",
    table "dbo.Project", column 'project_id'.

**Expected:** `run.file` against a seed template I'm calling **explicitly** should re-execute the file. The checksum cache should not silently skip.

**Actual:** The runner consults the `__noorm_*` change-tracking tables (which `truncate()` correctly preserves), sees a matching checksum, decides the file is unchanged, and returns `{ status: 'skipped' }`. From the caller's perspective the call succeeded but no SQL ran.

**Workaround:** Pass `{ force: true }`:

    await ctx.noorm.run.file('sql/06_seeds/11_Sentinels.sql.tmpl', { force: true });

That is documented in the SDK reference for `run.build()` but not as prominently for `run.file()`. Also documented for the CLI as `--force run file <path>`.

**Suggested fix:** Either log a `file:skip` event with `reason: 'unchanged'` (so the caller can react) or default `run.file()` to `force: true` when called directly via the SDK (the build pipeline can keep its checksum behaviour). At minimum, update the SDK reference to call out the implicit checksum gating on every `run.*` method.


## 8. SDK's named-parameter proc call sends `undefined` as `NULL`

**Severity:** medium — surprising for callers who relied on the proc's parameter defaults.

**Repro:**

    // SQL: sp_Memory_Create has @was_inferred BIT = 0 (default)
    // Memory table: [was_inferred] BIT NOT NULL DEFAULT 0
    // Zod schema:
    const memoryFlags = {
        wasInferred: z.boolean().optional(),  // → parsed as undefined when missing
        wasObserved: z.boolean().optional(),
        // ...
    };

    // Caller omits the flags:
    await db.memory.cmd.create({ content: 'x', domain: 'backend', category: 'fact' });

    Error: Cannot insert the value NULL into column 'was_inferred',
    table 'noorm_llm_test.dbo.Memory'; column does not allow nulls.

**Expected:** A named-parameter call where the user omits a parameter should let the proc's `= 0` default apply. Either the SDK should drop the key entirely from the EXEC statement, or should not send `@was_inferred = NULL` when the source value is `undefined`.

**Actual:** `undefined` becomes `NULL` in the rendered `EXEC sp_Memory_Create @was_inferred = NULL, ...`. MSSQL applies the default only when the parameter is *omitted* from the call, not when it's explicitly NULL. The NOT NULL column rejects the insert.

**Workaround:** In every Zod schema, replace `.optional()` with `.default(false)` (or whatever the proc default is). Now the parsed input always has a concrete value:

    const memoryFlags = {
        wasInferred: z.boolean().default(false),
        // ...
    };

This works but it pushes the proc's default knowledge into the TypeScript layer, which means changing the proc default requires also touching the Zod schema. If we forget, the test still passes (because we're sending `false`).

**Suggested fix:** When building named-parameter EXEC statements, the SDK should `delete obj[key]` (or skip emitting the param) when `obj[key] === undefined`. That preserves the principle "undefined means absent, null means explicit NULL", which is the JS convention for HTTP query params, JSON serialization, etc.

**Status:** Resolved as documentation. The `undefined` / `null` → SQL `NULL` mapping is intentional — the SDK picks one wire-level meaning for "absent value" and refuses to split it across two JavaScript shapes. The workaround (use `.default(...)` in Zod, or build the params object without the key) is now documented as a first-class convention. See `docs/reference/sdk.md` "Parameter handling and NULL semantics" and `docs/guide/troubleshooting.md`.


## 9. `noorm db create` lacks `--name`; documented invocation in instructions doesn't exist

**Severity:** low — but worth noting because the instructions in `tmp/instructions-mssql.md` rely on it.

**Repro:**

    $ noorm help db create
    Unknown command help
    $ noorm db create --help
    USAGE  noorm create [OPTIONS]
    OPTIONS
      -c, --config=<config>    Use specific configuration
                 --json        Output JSON
    EXAMPLES
      noorm db create
      noorm db create -c dev
      noorm db create --json

There is no `--name <database>` flag. Env-only mode (`NOORM_CONNECTION_*` env vars) doesn't help either:

    $ NOORM_CONNECTION_DIALECT=mssql NOORM_CONNECTION_DATABASE=noorm_llm_dev ... noorm --json db create
    Error: No active configuration. Use: noorm config use <name>

**Expected:** Either the `--name` flag the instructions document, or env-only mode that creates whatever DB the connection env vars point at. The instructions read as if the agent should be able to provision both DBs before any config is added.

**Actual:** `noorm db create` requires an active named config. The actual flow is:

    1. Write settings.yml + dev/test config JSON files
    2. noorm config import dev.json && noorm config import test.json
    3. noorm db create -c dev && noorm db create -c test
    4. noorm config use dev

**Workaround:** Followed the inverted flow above. Worked fine after recognising the requirement.

**Suggested fix:** Either add a `--name` flag (with `--dialect`, `--host`, etc.) for true env-less DB creation, or update the playbook in `tmp/instructions-mssql.md` to reflect the actual flow. The current instructions imply an order of operations that the CLI doesn't support.

**Status:** Resolved as documentation. The configs-first workflow (`config import` → `db create -c <name>` → `config use`) is intentional — configs are the canonical source of truth for connection info, and a parallel `--name` flag would duplicate that record. See `docs/guide/database/create.md` for the full reasoning and end-to-end CI bootstrap.


## 10. `noorm help <subcommand>` is not implemented

**Severity:** trivial — documentation polish.

**Repro:**

    $ noorm help db create
    Unknown command help
    $ noorm db create --help    # ← this works

The CLI has a `help` subcommand for the root (`noorm help`) but not for nested commands. The instructions in `tmp/instructions-mssql.md` say to `noorm help db create` first.

**Suggested fix:** Either alias `noorm help <cmd> <sub>` to `noorm <cmd> <sub> --help`, or remove the example from the instructions. The CI/CD examples in `references/cli.md` already show the `--help` form consistently.

**Status:** Resolved as documentation. citty (the CLI framework) doesn't ship a re-dispatching `help` subcommand, and the `--help` / `-h` flag is the canonical surface across every `noorm` command. The convention is now documented at `docs/cli/help.md`, with a redirect note in `docs/guide/troubleshooting.md`.


## 11. SDK vault.init() returned-tuple semantics changed; previously-idempotent test now fails

**Status:** Fixed — `vault.init()` is now idempotent at the SDK boundary. A second call returns `[null, null]` instead of `[null, Error('Vault already initialized')]`. The contract is documented in `docs/dev/vault.md` and `docs/reference/sdk.md`. The example test in this directory (`tests/integration/vault.test.ts:106`) still expects the old error contract; it will be updated on next sync.

**Severity:** medium — silent contract change in a public SDK surface.

**Repro:** `bun test tests/integration/vault.test.ts` after the user's in-flight modifications to `src/sdk/namespaces/vault.ts` (visible in `git diff` from the monorepo root). The test at lines 117–137 (`describe('vault: init is idempotent', ...)`) calls `ctx.noorm.vault.init()` twice on the same context and asserts the second call returns `[null, null]` — i.e. true idempotency at the SDK boundary.

**Expected:** A documented `init()` contract — either truly idempotent (return `[existingKey, null]` on a second call) or always returning the already-initialized error. Whichever shape ships, the SDK reference in `references/sdk.md` should match the runtime behaviour so example authors and downstream agents can write tests that don't drift.

**Actual:** A second `init()` returns `[null, new Error('Vault already initialized')]`. The example test was authored assuming `[, err]` would be `null` — that contract was either inferred from older docs or from a prior SDK shape, and there's no entry in the changelog or SDK reference signalling the change.

**Workaround:** Test was updated in this Phase 2 pass to assert the actual returned-error contract: a second `init()` returns `[null, Error]` where the message matches `/already initialized/i`, while `vault.status()` still reports `isInitialized: true` and `hasAccess: true`. The vault state itself remains idempotent — only the SDK signal differs.

**Suggested fix:** Pick a contract and document it. Either make `init()` truly idempotent at the SDK boundary (treat "already initialized" as success and return `[existingKey, null]`), or update `references/sdk.md` to make clear that calling `init()` twice returns a sentinel error. The "return existing key" shape is friendlier for example/test authors who otherwise have to special-case the error string.

**Note:** The same `git diff` against the monorepo root shows uncommitted changes to `src/sdk/context.ts`, `src/sdk/namespaces/vault.ts`, `src/sdk/sql.ts`, and `tests/sdk/sql.test.ts`. The vault namespace now lazy-loads the crypto identity via `loadIdentityMetadata()` from `~/.noorm/identity.json`. That changes first-`init()` behaviour in environments where the JSON file is missing — worth flagging as a related observability concern: an example project that ran fine yesterday may now error on first init if the user's identity directory is in a different shape.


---

## Summary

| # | Title | Severity | Workaround |
|---|---|---|---|
| 1 | `noorm init` requires TTY | medium | User runs interactively |
| 2 | `noorm config add` is TUI-only | medium | Use `noorm config import` |
| 3 | Runner doesn't split MSSQL `GO` batches | **high** | One CREATE per file |
| 4 | Build/run failures lack error detail | **high** | Fall back to `noorm sql -f` |
| 5 | `db.reset()` drops tables before functions | medium | Avoid `reset()` in tests |
| 6 | `db.truncate()` deadlocks on `sp_MSforeachtable` | **high** | Hand-rolled FK-ordered DELETE |
| 7 | `run.file()` silently skips by checksum | medium | Pass `{ force: true }` |
| 8 | SDK sends `undefined` as `NULL` to procs | medium | Use Zod `.default(...)` not `.optional()` |
| 9 | `db create --name` doesn't exist | low | Invert: configs first, then create |
| 10 | `noorm help <sub>` not implemented | trivial | Use `--help` |
| 11 | `vault.init()` returns error on second call | medium | Test asserts error tuple, not null |

Three of these (#3, #4, #6) materially blocked the build at one point or another and would have stopped a less determined caller cold. The rest are polish or surprising-but-recoverable.
