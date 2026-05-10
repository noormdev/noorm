# PHASE 1 COMPLETE

Project:        examples/llm-memory-db-pg/
Schema:         38 tables, 18 views, 69 procedures (10 FN + 59 PROC), 10 functions, 10 triggers
Tests:          157 passing, 0 failing (across 21 files, 324 expect() calls)
Type casts:     0 unjustified (1 justified `as` in src/note/commands.ts at the SDK proc-return boundary; 1 justified in src/sdk/context.ts at the pg-driver error boundary; 3 justified `as never` in tests/sdk/sql.test.ts for testing the SQL compiler)
`any` types:    0
Change history: 1 change applied (`2026-05-10-add-memory-tag-color`)

MCP config written to: examples/llm-memory-db-pg/.mcp.json

---

## What was built

### SQL schema (140 files)

- `sql/00_types/` — empty (audit confirmed no procs need composite types)
- `sql/01_reference/` — 10 reference tables (RelevanceStatus, TrackingStatus, NoteType, MemoryDomain, MemoryCategory, DependencyVerb, MemoryRelationVerb, StateTransitionType, TrackingStatus_Allowed, RelevanceStatus_Allowed)
- `sql/02_tables/` — 8 elevated entities (Agent, Project, Note, Tag, Memory, Artifact, Milestone, StateTransition) + 1 hierarchic (Task)
- `sql/03_subtypes/` — 8 exclusive subtypes (3 *_Note, 5 *_StateTransition)
- `sql/04_binary/` — 11 binary fact tables (5 *_Tag, Project_Memory, Project_Milestone, Related_Memory, Milestone_Artifact, Task_Artifact, Task_Dependency)
- `sql/05_seeds/` — 3 idempotent seed templates seeding all reference values, allowed-transition edges, and Agent(0)/Project(0) sentinels
- `sql/06_functions/` — 10 functions (recursive CTE for `fn_TaskDependencyWouldCycle`, composite scoring for `fn_MemoryRank`)
- `sql/07_views/` — 18 views including 5 UNION-ALL views (`vw_Tag`, `vw_Artifact`, `vw_Related_Memory`, `vw_Recent_Activity`, `vw_StateTransition`)
- `sql/08_procedures/` — 69 procs across 10 domain folders, full state-machine + audit logging on every `Set*` proc
- `sql/09_triggers/` — 4 trigger functions wiring 10 trigger bindings for Note + StateTransition exclusivity (subtype-side AND basetype-side type-update guards)

### TypeScript SDK (`src/`)

- 9 domain folders (Agent, Project, Memory, Note, Tag, Artifact, Milestone, Task, Audit) each following the 5-file shape (`types.ts`, `schema.ts`, `commands.ts`, `queries.ts`, `index.ts`) — except Audit which is read-only (4 files, no `commands.ts`).
- `src/core/` houses the abstract `Repo` base, the typed `createContext` factory, and the composing `DB` / `Procs` / `Funcs` / `Tvfs` types.
- `src/index.ts` exposes the `LlmMemoryDb` facade with `cmd`/`qry` per domain (`audit` is `qry`-only).
- Zod at every `cmd.*` boundary; camelCase user-facing → snake_case (`p_*`) at the proc binding.

### Tests (21 files)

- `tests/sql/` (9 files) — direct `ctx.proc` / `ctx.func` / `ctx.kysely` against the schema. Covers happy paths AND SQL-level rejections (state-machine, cycle detection, exclusivity triggers, sentinel guards, FK violations, unique constraints).
- `tests/domain/` (8 files) — facade-only (`db.<domain>.cmd|qry.*`). Covers happy paths AND Zod failure modes (empty content, invalid enum values, out-of-range IDs).
- `tests/integration/` (4 files) — observer events (`file:after`, `change:complete`, regex pattern matching, status=failed), lock acquire/release/withLock + re-entrant behavior, vault init/set/get/list/delete round-trip, impersonation against a limited PG role.

### Change system

`changes/2026-05-10-add-memory-tag-color/` — applied via `noorm change ff`. Forward adds `Tag.color VARCHAR(16) NOT NULL DEFAULT ''` and threads it through `vw_Tag`. Revert restores the v1 view shape and drops the column. `noorm change history --json` confirms `status=success`.

### Test bootstrap (`tests/helpers/test-context.ts`)

- Memoised `bootstrap()` — `bun test --serial` shares one connected context across all 21 files.
- `requireTest: true` safety guard.
- `db.reset()` (teardown + build) on first call, then `changes.ff()` to apply all pending changes (so `Tag.color` is present in the test DB).
- `truncateAll(ctx)` re-seeds reference values + sentinels between every `it()` block.

---

## noorm SDK bugs discovered (and fixed)

The exercise's stated purpose was to surface noorm gaps. Three real SDK bugs surfaced, each fixed at the source in `packages/sdk/`. The macOS arm64 binary at `~/.local/bin/noorm` was rebuilt and installed with all three fixes; the previous binary is backed up at `/tmp/noorm-old-backup`.

### Bug 1 — `ctx.proc()` doesn't quote PG identifiers

`buildProcCall`/`buildFuncCall`/`buildTvfCall` passed proc/func/tvf names through `sql.raw(name)` so PG case-folded them to lowercase. `sp_Memory_Create` resolved as `sp_memory_create` → "does not exist". Same for PG named-arg keys.

**Fix**: added `quoteIdent(dialect, name)` in `src/sdk/sql.ts` that handles PG (`"x"`), MSSQL (`[x]`), MySQL (`` `x` ``), with proper escape-char doubling. Wrapped every identifier passing through `sql.raw()` (proc/func/tvf names, PG named-arg keys, column aliases). Test coverage in `tests/sdk/sql.test.ts` covers CamelCase names, schema-qualified names, embedded-quote escaping, named-arg key quoting, and Kysely table-name regression smoke tests across all three dialects (74 unit tests).

### Bug 2 — SDK can't call PG FUNCTIONs via `ctx.proc()`

The playbook says "PG: use `CREATE OR REPLACE PROCEDURE` for void-returning ops, `CREATE OR REPLACE FUNCTION` for procs that return rows. Match the SDK's `proc()` invocation conventions." But the SDK always emitted `CALL <name>(...)`, which only works against PROCEDURE objects. Calling a FUNCTION via `CALL` returns SQLSTATE `42883` with hint "To call a function, use SELECT."

**Fix**: in `src/sdk/context.ts`, `Context.proc()` for PG now tries `CALL` first; on SQLSTATE `42809` ("is not a procedure") OR `42883` with the "use SELECT" hint, it transparently retries via `buildTvfCall` (`SELECT * FROM <name>(args)`), which works for both scalar-returning and set-returning PG functions. The fallback uses `attempt` (no try/catch). Tested in `tests/sdk/sql.test.ts` (predicate behavior + emitted SQL shape).

### Bug 3 — vault.ts read `state.identity.publicKey` which never existed

`VaultNamespace` cast `state.identity` to `{ publicKey: string; identityHash: string }` but the SDK's audit `Identity` only has `{ name, email, source }`. The cryptographic public key + identityHash live on `CryptoIdentity` loaded from `~/.noorm/identity.json` (or `NOORM_IDENTITY_*` env). Result: vault.init() called `createPublicKey({ key: empty buffer, ... })` → "Failed to read asymmetric key" → vault unusable from any SDK consumer.

**Fix**: in `src/sdk/namespaces/vault.ts`, added a private `#getCryptoIdentity()` method that lazy-loads + caches the on-disk metadata via `loadIdentityMetadata()`. Updated `init`, `status`, `copy`, and `#getVaultKey` to await it. Removed the broken `#identityHash` / `#publicKey` getters entirely.

---

## noorm SDK quirks logged (less severe)

- `noorm init`, `noorm config add`, `noorm sql repl`, `noorm settings edit/secret`, `noorm identity init` are TTY-only and refuse to run in non-interactive shells. The non-interactive escape hatch for `noorm config add` is `noorm config import <json>`.
- `noorm change ff --dry-run` is **not** actually a dry run — it commits the change to history. (Reproduced and logged in T1.6's executor report.)
- `--json` flag must come AFTER the subcommand. `noorm --json config list` prints human text; `noorm config list --json` prints JSON. Same for `noorm sql query "..." --json`.
- `noorm sql "<query>"` with a multi-word query gets parsed by citty as a subcommand; you must use `noorm sql query "<query>"`.
- `noorm settings build` silently strips `rules[].description` and the `strict` block when normalizing the YAML.
- `ctx.proc()` returns `T[]` (an array), not `T`. The shared proc-authoring conventions doc had this wrong — typecheck caught it during T1.7k and the fix was applied to all 8 `sp_*_Create` wrappers via destructure-and-guard (`const [row] = result; if (!row) throw …`).
- `vault.init()` is one-shot, not idempotent — returns `[null, Error("Vault already initialized")]` on repeat calls. Caller-friendly behavior (no try/catch needed) but worth documenting.
- `noorm.run.file()` resolves on SQL failure rather than rejecting; the failure is surfaced via the `file:after` event's `status` field and the returned result object's `status: 'failed'`. Subscribe to events for granular feedback.
- The PG container's `tmpfs: /var/lib/postgresql/data` mount is RAM-backed and limited; aggressive teardown+build cycles can exhaust it ("[PANIC 53100] No space left on device"). A targeted `docker restart noorm-test-postgres` clears it.

---

## Schema convention recommendation

The proc-authoring conventions used `p_<name>` parameter prefixes to dodge plpgsql column-name collisions in proc bodies. This forced the SDK call sites and `Procs` interface keys to use the same `p_*` prefix verbatim — PG's named-arg syntax requires exact name matches. **The proc parameter type should be `TEXT`, not `VARCHAR(N)`**: PG's overload resolution can't coerce `unknown` (the type pg-driver sends string params as) to `varchar` cleanly, but coerces to `text` reliably. Param type is independent of the underlying column type — the function body still inserts into `VARCHAR(N)` columns.

---

## To continue (Phase 2)

1. The MCP config at `examples/llm-memory-db-pg/.mcp.json` is project-scoped — Claude Code reads it automatically when launched from this directory.
2. Restart this Claude Code session.
3. Resume with the prompt: "Continue from Phase 2 of `tmp/instructions-postgres.md`".
