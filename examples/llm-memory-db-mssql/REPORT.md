# llm-memory-db-mssql — Phase 1 + Phase 2 Report


An end-to-end noorm example built against SQL Server 2022 to exercise the SDK over MSSQL-specific surfaces. Phase 1 stood up the schema, the per-domain SDK, and the first 194 tests under CLI control. Phase 2 verified everything via the noorm MCP, ran a per-test-file review loop, and added the meta-test that proves the MCP itself works.

This report assumes the reader has already skimmed `README.md`. Counts here come from live MCP queries (`overview`, `list category=types`) and from the test runner.


## 1. What was built


Counts (verified via `run_noorm_cmd("overview", { config: "dev" })`):

- 38 tables
- 18 views
- 72 procedures
- 14 functions (5 schema-bound validators + 8 business-logic UDFs + 1 inline TVF)
- 4 TVP table types
- 39 indexes, 68 foreign keys, 0 triggers

File layout (one-liner per major dir):

    sql/00_types/         4 TVP table types (1 file each)
    sql/01_reference/     lookup tables (status, category, verb, ...)
    sql/02_tables/        core entities (Memory, Tag, Project, Agent, ...)
    sql/03_validators/    5 schema-bound BIT-returning UDFs for inline CHECKs
    sql/04_subtypes/      subtype tables with named CHECKs calling validators
    sql/05_binary/        binary fact and association tables
    sql/06_seeds/         reference whitelists + sentinel rows (Agent 0, Project 0)
    sql/07_functions/     8 business UDFs + 1 inline TVF (`tvf_FilterMemoriesByTags`)
    sql/08_views/         18 role-scoped / projection views
    sql/09_procedures/    73 one-statement files (gap #3 — see below)
    src/<domain>/         per-domain SDK code (agent, artifact, audit, core,
                          memory, milestone, note, project, tag, task)
    tests/sql/            SQL-surface tests (procs, views, functions, TVF, TVP)
    tests/domain/         SDK + Zod + business-logic tests
    tests/integration/    observer, lock, vault, impersonation, mcp-discovery
    tests/helpers/        shared bootstrap + resetApplicationData
    changes/              versioned change scripts (1 applied to dev)

Design decisions:

- **No triggers anywhere.** Subtype exclusivity and the StateTransition discriminator rules are enforced by inline named CHECK constraints in `sql/04_subtypes/` calling validator UDFs in `sql/03_validators/`.
- **Validators are schema-bound** (`WITH SCHEMABINDING`) so they may be referenced by inline CHECKs at table-create time. They reference only `01_reference/` and `02_tables/` because subtype tables do not exist yet at validator-create time.
- **Bracketed identifiers everywhere.** Every column, table, type, and constraint name is bracketed (`[Memory]`, `[memory_id]`, `[FK_Memory_Project]`). T-SQL is permissive about reserved words but consistent bracketing avoids surprises with names like `[Note]` and `[Tag]`.
- **`NVARCHAR` for all text.** Reference whitelists use `VARCHAR(32)` for stable enum-style codes; everything that holds user content uses `NVARCHAR(MAX)` or `NVARCHAR(255)`.
- **One CREATE per `.sql` file.** Forced by the runner's missing `GO` splitter (gap #3); no `GO` appears anywhere under `sql/`.


## 2. Coverage stats


Tests (verified via `bun test`):

- 223 pass, 0 fail
- 595 expect() calls
- 24 test files

Per-layer breakdown:

- `tests/sql/` — 11 files, 102 tests, raw SDK calls (`ctx.proc/func/tvf/kysely`)
- `tests/domain/` — 8 files, 98 tests, facade calls (`db.<domain>.cmd/qry.*`)
- `tests/integration/` — 5 files, 23 tests (incl. the MCP discovery meta-test)

Schema-object coverage:

- Procedures: every proc name in `sql/09_procedures/` has at least one reference under `tests/`. The bulk TVP variants (`sp_Tag_Bulk_Attach_Memory`, `sp_Memory_Bulk_Touch`, `sp_Task_Bulk_Depend`) are exercised at both the `sql/` and `domain/` layers.
- Views: 18 / 18 queried at least once across `tests/sql/views.test.ts` and the domain tests.
- Functions: 14 / 14 (5 validators called via subtype-CHECK rejections and direct proc-side invocation; 8 business UDFs in `tests/sql/functions.test.ts`; the TVF in `tests/sql/tvf.test.ts`).
- TVP types: 4 / 4 exercised across 4 dedicated test paths.

Meta-test: `tests/integration/mcp-discovery.test.ts` (5 tests) drives the noorm MCP from inside the suite — it lists commands via `noorm_help`, runs `overview`, runs `list category=types`, and asserts the bad-command case errors cleanly. This file proves the MCP wiring itself works, not just the SDK.

Type discipline (verified via grep): 0 `as Type` casts, 0 `: any` annotations across `src/` and `tests/`. The single `as const` in `tests/helpers/test-context.ts` narrows a literal tuple — not a cast.


## 3. TVP-specific findings


The 4 TVP table types and where they are used:

| Type                    | Used by                                |
|-------------------------|----------------------------------------|
| `TagAttachmentInput`    | `sp_Tag_Bulk_Attach_Memory`            |
| `MemoryIdSet`           | `sp_Memory_Bulk_Touch`                 |
| `TagIdSet`              | `tvf_FilterMemoriesByTags`             |
| `TaskDependencyInput`   | `sp_Task_Bulk_Depend`                  |

Pre-flight 2,100-parameter limit. SQL Server caps the parameter count per RPC at 2,100. The SDK throws synchronously before reaching tedious — a 1,100-row TVP × 2 columns = 2,200 inferred parameters is rejected with a message containing both `2100` and `parameter`. The pre-flight is exercised in `tests/sql/tag-tvp-edge-cases.test.ts` and the assertion verifies that no rows leak into `Memory_Tag` because the proc was never called.

200-row vs near-limit trade-off. 200 rows × 2 columns = 400 parameters lands comfortably under the cap and runs in the per-test budget without slowing the suite. Approaching the cap (rows × cols → 2,100) forces the caller to split client-side. The 200-row regime is the fast-path test; the 1,100-row regime is the failure-path test. Both live in `tests/sql/tag-tvp-edge-cases.test.ts`.

Empty-TVP semantics. `tvp('TagAttachmentInput', [])` round-trips cleanly: the proc receives an empty table-typed parameter and the `INSERT ... WHERE NOT EXISTS` shape no-ops without raising. Verified by reading back zero rows from `Memory_Tag`. The same pattern holds for `sp_Memory_Bulk_Touch` (a UPDATE that matches zero rows) and `tvf_FilterMemoriesByTags` (a relational-division that returns zero rows when the input set is empty).

Type-name observation. The `tvp()` helper takes the table-type name as a string. A typo is only caught when the proc call hits the driver — by then the test is mid-execution. We mitigate by:

- One single-source-of-truth declaration per type in `sql/00_types/`.
- Explicit per-type tests in the TVP suites (so a typo surfaces in one specific test, not as a cascading suite collapse).


## 4. T-SQL specifics


Cascade-cycle handling. MSSQL rejects multiple cascade paths to the same table. Rather than crafting partial cascades that work for some FKs and not others, the schema uses `ON DELETE NO ACTION ON UPDATE NO ACTION` on every FK that would touch a sentinel-protected entity (Agent, Project) or a reference table. Lifecycle is then handled by the procedure layer — `sp_Agent_Delete` reassigns `Project.agent_id`, `Memory.agent_id`, and `Task.agent_id` to sentinel `0` instead of cascading. Cascades are only used where one side strictly owns the lifecycle (e.g. association rows in `sql/05_binary/`). Comments in `sql/02_tables/` files document each `NO ACTION` swap rationale.

Reserved-word bracketing. Every identifier is bracketed — column names, table names, constraint names. T-SQL would let us drop the brackets in many places, but consistent bracketing eliminates the class of "is this a keyword?" questions for names like `[Note]` and `[Tag]`.

Identity-insert sequencing for sentinels. `Agent(0)` and `Project(0)` are seeded in `sql/06_seeds/11_Sentinels.sql.tmpl` with `SET IDENTITY_INSERT [dbo].[Agent] ON; INSERT ...; SET IDENTITY_INSERT [dbo].[Agent] OFF;` (and the same for `Project`). The Project sentinel's `agent_id` FK references `Agent(0)`, so Agent must seed first — the file does Agent → Project in that order, gated by `IF NOT EXISTS` so it is idempotent. The runner picks this file last in the seed bucket because `11_` sorts after the reference-data seeds.

Validator vs business-logic UDF split. Two separate buckets:

- `sql/03_validators/` — 5 schema-bound BIT-returning UDFs that subtype CHECK constraints reference at table-declaration time. These cannot reference subtype tables (those do not exist at validator-create time) so they only touch `01_reference/` + `02_tables/`.
- `sql/07_functions/` — 8 business-logic UDFs (e.g. `fn_MemoryConfidence`, `fn_TaskDependencyWouldCycle`, `fn_MemoryRank`). These run at proc time, not at constraint time, so they may freely reference whatever is built by then.

The split exists because schema-bound functions can only reference objects that already exist when they are created, and CHECK constraints freeze the validator dependency graph at table-build time. Procs in `sql/09_procedures/` defensively call the same validator UDFs the CHECKs use — defense in depth, since callers that bypass the proc layer still hit the constraints.

No triggers anywhere. Discriminator and exclusivity rules are CHECK + validator UDF; mutation history is a separate `StateTransition` table written by the procedures, not by triggers.


## 5. Cross-reference: noorm gaps


`mssql-problems.md` records 11 gaps surfaced during the build. Severity mix:

- **High (3):** #3 GO splitter, #4 silent build failures, #6 truncate deadlock
- **Medium (6):** #1 TTY-only init, #2 TUI-only config add, #5 reset ordering, #7 run.file checksum skip, #8 undefined-as-NULL, #11 vault.init contract change
- **Low (1):** #9 missing `db create --name`
- **Trivial (1):** #10 `noorm help <sub>` not implemented

Two gaps directly shape the test bootstrap:

- **Gap #5 + Gap #6** — schema-bound validators block `db.reset()`, and `db.truncate()` deadlocks on `sp_MSforeachtable` against a 38-table schema. Together they forced the hand-rolled `resetApplicationData(ctx)` helper in `tests/helpers/test-context.ts`, which issues FK-ordered `DELETE` statements over a single connection and re-seeds sentinels. Every test file's `beforeEach` calls this helper, not `db.truncate()`.

Gap #11 is new in Phase 2 — discovered when `tests/integration/vault.test.ts` was reviewed against in-flight SDK changes to `src/sdk/namespaces/vault.ts`. The test now asserts the actual returned-error contract for a second `vault.init()` call.

Gap-level details are not duplicated here — `mssql-problems.md` is the source.


## 6. Schema-artifact judgment calls


Where the original `tmp/llm-memory-db.pseudo` artifact left ambiguity, the schema and tests took these positions:

- **`vw_Recent_Activity` surfaces `entity_type = 'transition'`.** The artifact's enum for `entity_type` listed memory/note/artifact/milestone/task but did not include `transition`. The view in `sql/08_views/` projects a literal `'transition'` for `StateTransition` rows, paired with `action_type = 'transitioned'`. Justification: a transition is a first-class activity event in this schema (immutable, no `updated_at`, exactly one row per state change), and the view is a UI-facing aggregator — collapsing transitions under the parent entity's row would lose the "what changed" signal.
- **Schema-bound validators reference only `01_reference` + `02_tables`.** The artifact described validators in informal terms; the implementation pinned the dependency boundary explicitly so the build order is acyclic and CHECK references resolve at table-create time.
- **Bulk-dependency cycle policy.** The artifact specified `sp_Task_Depend` cycle-checks single edges; the bulk variant `sp_Task_Bulk_Depend` checks each row against the *current* graph but does not reject batches that only cycle when combined. The proc and the test in `tests/domain/task.test.ts` document this trade-off; cycle-sensitive workflows should prefer the single-row `sp_Task_Depend` path.
- **MCP command surface.** The Phase 2 playbook expected MCP commands named `info` and `db.explore`. The actual MCP surfaces them as `connect`, `overview`, `list`, `detail`. The mcp-discovery test asserts the actual surface; the playbook reference is stale documentation. Not added to `mssql-problems.md` because the MCP works correctly — only the playbook is out of date.


## Done definition


All Phase 2 acceptance criteria met:

- `bun test` passes 223/223 (no regressions from Phase 1's 194)
- `tests/integration/mcp-discovery.test.ts` exists and passes (5 tests via `@modelcontextprotocol/sdk` Client)
- `REPORT.md` exists at `examples/llm-memory-db-mssql/REPORT.md`
- `mssql-problems.md` exists with all 11 gaps (10 carried over + 1 added in Phase 2)
- `README.md` rewritten from `bun init` boilerplate
- Reviewer subagent's final pass returns clean
- All Phase 2 todos marked completed
