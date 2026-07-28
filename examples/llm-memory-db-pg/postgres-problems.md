# Phase 1 — STOP report: noorm SDK bugs blocking the PG example

Generated while building `examples/llm-memory-db-pg/` per `tmp/instructions-postgres.md`. Phase 1 progressed cleanly through schema, change-system, SDK typecheck, and test-file authoring, then hit a hard wall at `bun test`. Two compounding bugs in the noorm SDK's PG procedure-call generator prevent any `ctx.proc(...)` call from succeeding against PG.

---

## What ran

`bun test` against the `noorm_llm_test` DB after a clean `db.reset() + changes.ff()`. Result: **22 pass / 132 fail / 154 total** in 14.4 s. Every failure is the same shape — the SDK can't call any of our `sp_*` procedures.

---

## Two compounding bugs in the noorm SDK's PG proc-call generator

Source: `packages/sdk/dist/index.js:17021-17029` (`buildPostgresProc`):

```js
function buildPostgresProc(rawName, params) {
    if (Array.isArray(params)) {
        const joined = sql.join(params.map((v) => sql`${v}`));
        return sql`CALL ${rawName}(${joined})`;
    }
    const parts = Object.entries(params).map(
        ([key, val]) => sql`${sql.raw(key)} => ${val}`
    );
    return sql`CALL ${rawName}(${sql.join(parts)})`;
}
```

…where `rawName = sql.raw(name)`.

### Bug 1 — proc name is case-folded by PG

The SDK emits `CALL <name>(...)` with the bare identifier. PG case-folds unquoted identifiers, so `sp_Memory_Create` → `sp_memory_create`. Our procs were created with quoted CamelCase names, so the lookup fails.

Reproducer (CLI, no test framework involved):

```text
$ noorm sql query "CALL sp_Memory_Create(content=>'x'::text, domain=>'backend'::text, ...)"
→ procedure sp_memory_create(content => text, …) does not exist

$ noorm sql query 'CALL "sp_Memory_Create"(content=>'\''x'\''::text, …)'
→ procedure sp_Memory_Create(content => text, …) does not exist   # case preserved with quotes
```

**Fix at the source**: `buildPostgresProc` (and the parallel MSSQL/MySQL helpers) should quote the proc identifier — e.g., `sql.id(name)` if Kysely exposes one, or hand-quote: `` `"${name.replace(/"/g, '""')}"` ``. Same pattern is already used for view/table identifiers throughout the SDK.

### Bug 2 — parameter names must match the function's declared param names verbatim

Even with the name quoted, PG still rejects the call:

```
function sp_Memory_Create(content => text, domain => text, …) does not exist
```

…because our proc's actual parameters are `p_content`, `p_domain`, etc. (the `p_` prefix the proc-authoring conventions told the executors to use, to avoid plpgsql column-name collisions in the body). PG's `name => $1` named-arg syntax requires the names to match the function declaration exactly.

This isn't strictly an SDK *bug* — it's a documentation gap. The SDK's named-arg path forces a hard contract between proc-author parameter names and SDK call-site keys. The shared conventions doc (`tmp/proc-authoring-conventions.md`) said "use `p_` prefix"; the playbook's example call site uses bare names (`content`, `domain`). Both are consistent on their own — together they break.

---

## What this means for the build

Everything *up through the schema* works:

- `noorm run build`: 140/140 files, 0 failed ✅
- `noorm db explore`: 38 tables, 18 views, 69 procs (10 FN + 59 PROC), 10 fns ✅
- `noorm change ff` end-to-end (with the `Tag.color` change applied) ✅
- `bun run typecheck`: 0 errors, 0 unjustified `as`, 0 `any` ✅

What fails: every `db.<domain>.cmd.*` call and every `tests/sql/*` `ctx.proc(...)` call. The PG database itself is fine — the issue is purely how the SDK addresses it.

---

## Three ways to unstick

1. **Patch the SDK** (`packages/sdk/src/sdk/sql.ts` → `buildPostgresProc` and friends): quote identifiers; consider also exposing a positional-only fast path for callers who don't want named-arg overhead. Cleanest fix; ships value to all noorm users.

2. **Stay on the named-arg API + match parameter names**: rewrite all 69 procs to drop the `p_` prefix and add table-qualified column references in bodies to avoid plpgsql ambiguity (e.g., `WHERE "Memory".memory_id = memory_id`). Roughly a one-day SQL refactor. The proc-authoring convention I wrote should be reversed.

3. **Switch every call site to positional arrays**: `ctx.proc('sp_X', [a, b, c])` instead of `ctx.proc('sp_X', { a, b, c })`. The SDK already supports this branch and it sidesteps Bug 2 entirely. Bug 1 (case-folding) still needs fixing — likely with a hand-quoted `'"sp_X"'` string at the call site, which is unergonomic but works without SDK changes. Roughly a half-day refactor across `src/<domain>/commands.ts` + `tests/sql/*.test.ts`.

I lean toward (1) — fixing the SDK is the right long-term move and it's a small change. (2) is also fine if you want to standardize on the named-arg style. (3) is the workaround if you want me to keep going without touching the SDK.

---

## Status against the playbook

**Phase 1 acceptance:**

| Item | Status |
|---|---|
| `.noorm/`, `sql/`, `changes/` bootstrapped | ✅ |
| dev + test DBs created via `noorm db create` | ✅ |
| `settings.yml` + dev/test configs registered | ✅ |
| Schema files authored (38 tables, 18 views, 69 procs, 10 fns, 10 triggers) | ✅ |
| `noorm run build` clean | ✅ (140/140 files) |
| Counts via `noorm db explore` match | ✅ |
| Change added + `change ff` applied | ✅ |
| SDK builds + typechecks (0 `as`, 0 `any`) | ✅ |
| Tests authored (21 files, layered SQL/domain/integration) | ✅ |
| **`bun test` all green** | ❌ blocked on Bug 1 + Bug 2 |
| `noorm mcp init` + Phase 1 report | ⏸ pending tests |

---

## Other noorm quirks logged along the way (less severe — for the eventual REPORT.md)

- `noorm init`, `noorm config add`, `noorm sql repl`, `noorm settings edit/secret`, `noorm identity init` are TTY-only — needed for Phase 1 bootstrap.
- `noorm config add` has no flags; the documented non-interactive escape hatch is `noorm config import <json>`.
- **`noorm change ff --dry-run` is not actually a dry run** — it commits the change to history. Reproducer in T1.6's executor report.
- `--json` global flag must be placed AFTER the subcommand. `noorm --json config list` produces human-readable output; `noorm config list --json` produces JSON. Same for `noorm sql query "..." --json`.
- `noorm sql "<query>"` with a multi-word query gets parsed by citty as a subcommand; you must use `noorm sql query "<query>"`.
- `noorm settings build` silently strips `rules[].description` and the `strict` block when normalizing the YAML.
- `ctx.proc()` returns `T[]` (an array of rows), not a single object. The shared proc-authoring conventions doc claimed otherwise; T1.7k's executor caught it during typecheck and fixed all 8 `sp_*_Create` wrappers with destructure-and-guard (`const [row] = result; if (!row) throw …`). Worth correcting in the SDK reference docs.

---

## What I need from you

Tell me which fix path to take and I'll resume — or, if you'd rather investigate the SDK yourself first, leave T1.8e blocked and ping me when you have a fixed `@noormdev/sdk` build in `packages/sdk/dist/`. I won't proceed to T1.9 (MCP setup + Phase 1 report) until tests are green.

---

# Phase 2 — 2026-05-10

Phase 2 resumed in a fresh session after the user wired the noorm MCP server. The three SDK bugs identified in Phase 1 are all fixed in the local binary; tests are green (157 pass, 0 fail) at session start.

## Finding 1 — MCP command names differ from CLI subcommand names (minor, docs gap)

The Phase 2 handoff document told me to verify the MCP by calling `noorm_help` and `run_noorm_cmd` with `command: "info"` and `command: "db.explore"`. Neither of those commands exists on the MCP. The MCP exposes a flatter, underscore-delimited namespace:

| Phase 2 doc reference | Actual MCP command |
|---|---|
| `info` | `list_configs` (configs) **or** `overview` (object counts) |
| `db.explore` | `overview` |
| `db.list` | `list` |
| `db.detail` | `detail` |
| `change.history` | `change_history` |
| `change.ff` | `change_ff` |
| `change.run` | `change_run` |
| `change.revert` | `change_revert` |
| `run.build` | `run_build` |
| `run.file` | `run_file` |
| `sql query` | `sql` |

This isn't a bug — the MCP just uses a different surface from the CLI. But the playbook (`tmp/instructions-postgres.md` §2.1) and the Phase 2 handoff reference CLI-style names (`db.explore`, `info`) that don't resolve through the MCP. **Hypothesis**: documentation drift between the CLI command tree and the MCP tool registry. The MCP is the canonical surface for AI agents, so the playbook should be updated to use MCP names — or the MCP should alias `db.explore` → `overview` and `info` → `list_configs` for parity. The MCP is also missing some CLI verbs (e.g., `connect`, `disconnect`, `run_build` exist but `db_create`, `mcp_init`, `settings_*`, `vault_*`, `identity_*` are not exposed). That's likely intentional (privileged ops) but worth documenting.

Reproducer:

```text
noorm_help() → returns: connect, disconnect, list_configs, overview, list, detail, sql,
                        change_history, change_run, change_ff, change_revert,
                        run_build, run_file
                       (no `info`, no `db.explore`, no `mcp_init`, no `db_create`)

run_noorm_cmd({command:"info"})          → presumably errors (didn't run — see below)
run_noorm_cmd({command:"list_configs"})  → ✅ returns array of configs
run_noorm_cmd({command:"overview", config:"dev"}) → ✅ returns {tables:38, views:18, procedures:59, functions:24, ...}
```

(Didn't actually invoke `info` to capture the exact error string — recording the symptom anyway because the handoff doc set me up to expect it to work.)

## Finding 3 — Domain-local `Procs`/`Funcs` types don't cover non-entity procs

While extending Phase 2 test coverage, executors discovered that the example project's `src/core/types.ts` `Procs` and `Funcs` composition includes only the **entity domain** procs (Memory, Note, Tag, Artifact, Milestone, Task, Agent, Project — via each `src/<domain>/types.ts`). It does NOT include:

- `sp_Cleanup` (TTL hard-delete proc)
- `sp_Ref_Create_*` / `sp_Ref_Delete_*` (reference-table mutators, 6 procs total)
- `fn_NoteSubtypeCount` / `fn_NoteMatchesSubtype` / `fn_IsActive` / `fn_IsOpen` (4 helper functions called only from view bodies / proc bodies, not from SDK consumers)

These procs/funcs are defined in `sql/06_functions/` and `sql/08_procedures/` and present in PG, but absent from the TypeScript catalog, so calling them via `ctx.proc(...)` / `ctx.func(...)` fails with TS2345 "argument of type 'sp_Cleanup' is not assignable to parameter of type Procs".

This is **not** an SDK bug — it's a Phase 1 authoring choice. The proc-authoring conventions encouraged domain-local types; admin/system-level procs (like Cleanup, Ref, and view-internal helpers) didn't fit any domain and were left out. **Reasonable trade-off**, but it forces test authors who want to exercise these procs to fall back to raw Kysely `sql\`CALL "sp_Cleanup"(${...})\`` patterns (which bypass the typed proc-call helper Phase 1 fixed via the SDK's CALL/SELECT fallback).

The fix (deferred to a future Phase 3 or post-MVP polish) is to add either:

- An `src/admin/` (or `src/system/`) domain with its own `types.ts` defining `AdminProcs` (Cleanup, Ref mutators) and `AdminFuncs` (the four helpers), then composing them into `core/types.ts`.
- OR, an "uncategorized" catalog extension for procs/funcs that don't belong to an entity domain.

**Where this hurts**: any Phase-3 user who wants to wire `sp_Cleanup` into a cron, or surface reference-data CRUD through the SDK, has to either add their own typings or fork the raw-SQL workaround. Documenting this in the example's REPORT.md.

## Finding 4 — PG noorm-system tables live under `noorm.*` schema, not `__noorm_*__` prefix

Lock contention test initially failed against `__noorm_lock__` (the SQLite/MySQL naming used in `NOORM_TABLES`). For PostgreSQL the noorm system tables live under the `noorm` schema (see `getNoormTables('postgres')` in `src/core/shared/tables.ts` returning `SCHEMA_TABLES` with bare names) and Kysely accesses them via `withSchema('noorm')` (see `noormDb()` in the same file).

**Hypothesis**: this is documented in the SDK source but easy to miss when authoring integration tests that need to bypass the SDK and direct-touch the noorm system table (e.g., to simulate cross-identity lock contention). Worth surfacing in noorm's public docs: "If you need to directly query/insert into noorm system tables, use `noorm.<table>` for pg/mssql; use `__noorm_<table>__` for sqlite/mysql. The `noormDb(db, dialect)` helper handles this for you."

## Finding 2 — `overview` returns `functions:24` but Phase 1 reported `10 functions + 10 triggers`

`run_noorm_cmd({command:"overview", config:"dev"})` returns:

```json
{ "tables": 38, "views": 18, "procedures": 59, "functions": 24, "types": 0,
  "indexes": 86, "foreignKeys": 68, "triggers": 10, "locks": 28, "connections": 9 }
```

The `functions: 24` count is correct — it's `10 fn_* (functions) + 10 sp_*_Create (FUNCTION-style procs) + 4 trigger functions = 24`. PG counts trigger functions in `information_schema.routines` because they're authored as `CREATE FUNCTION ... RETURNS trigger`. This isn't a bug in the MCP — it's PG's data model — but it means **the `functions` and `procedures` columns in MCP `overview` don't map cleanly to user-authored concepts**. If a user wrote a script that expected "10 functions" (per the schema artifact) and read `functions: 24`, they'd get confused. Suggestion: split this into `functions`, `procedures`, `trigger_functions`, or add a `kind` filter to `list` so callers can disambiguate. Minor.


