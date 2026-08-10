# SDK schema scoping — `Context.withSchema`


## Goal


`Context.withSchema<SDB, SProcs, SFuncs, STvfs>(name)` on `@noormdev/sdk` returns a derived `Context` scoped to one schema — same connection/pool as the parent, fresh generics for the schema's shape, with the query builder and `proc`/`func`/`tvf` calls transparently qualified by `name`, composing automatically through `transaction()` and `impersonate()`.


## Non-goals


- No config/connection-level schema field — the connection stays schema-agnostic; `withSchema` is per-call-site sugar, not connection state.
- No rewriting of unqualified identifiers inside `` sql`…` `` fragments. They resolve against the connection default regardless of `withSchema` — inherent to Kysely's plugin model, documented as a caveat, no workaround attempted.
- No schema-defaulting of `ctx.noorm.db.describe*`'s `schema?` argument.
- No per-dialect gating of the schema qualifier. It means whatever Kysely's `withSchema` means for the active dialect (a schema on postgres/mssql, a database on mysql, an ATTACHed database name on sqlite) — the SDK does not special-case any dialect.


## Success criteria


- [ ] `const derived = ctx.withSchema<SDB>('acct')` returns a `Context` instance whose `.kysely` getter compiles queries with `acct`-qualified identifiers, verified by compiling against a dialect query compiler (`DummyDriver` + `PostgresQueryCompiler`, mirroring `tests/sdk/sql.test.ts`'s compiled-SQL assertion pattern) in `tests/sdk/with-schema.test.ts`.
- [ ] Calling `withSchema` again on an already-derived context (`ctx.withSchema('a').withSchema('b')`) replaces rather than stacks — compiled SQL is qualified with `b` only.
- [ ] `derived.proc(name, …)`, `.func(...)`, `.tvf(...)` prefix `name` with `${schema}.` unless `name` already contains a `.`, verified against `buildProcCall`/`buildFuncCall`/`buildTvfCall` (`src/sdk/sql.ts`) output.
- [ ] An invalid schema name throws synchronously from `withSchema` before any connection is borrowed or `#state` is touched.
- [ ] `derived` and its parent share one `#heldConnections` Set: an explicit-mode impersonation scope opened via `derived.impersonate(username)` is released when `parent.disconnect()` runs.
- [ ] `derived.transaction(fn)` and `derived.impersonate(username, fn)` both resolve schema-qualified, verified against live postgres/mysql/mssql/sqlite in `tests/integration/sdk/with-schema.test.ts`.
- [ ] `derived.noorm` exposes the same operations against the same shared `#state` as `parent.noorm` — no schema-specific noorm behavior.
- [ ] `packages/sdk/README.md` and `docs/reference/sdk.md` document `withSchema`, including the raw-`sql` caveat and all four non-goals.
- [ ] `bun run typecheck`, `bun run lint`, and the full test suite (CI's 5-group split, per `docs/wiki/index.md`) pass; `tests/integration/sdk/with-schema.test.ts` passes against the `docker-compose.test.yml` services.


## Approach

Derived-context API (`Context.withSchema`, sharing parent state) — see `docs/design/sdk-with-schema.md`.


## Change tree

```
src/sdk/
└── context.ts ............................. M  (withSchema; kysely getter re-derivation; proc/func/tvf prefixing)
tests/sdk/
└── with-schema.test.ts .................... A  (unit: compiled-SQL qualification, prefixing, validation, shared #heldConnections)
tests/integration/sdk/
└── with-schema.test.ts .................... A  (live-DB: schema-scoped queries, transaction + impersonation composition, cross-dialect)
packages/sdk/
└── README.md ............................... M  (schema-scoping section + raw-SQL caveat)
docs/reference/
└── sdk.md ................................... M  (withSchema API reference)
.changeset/
└── sdk-with-schema.md ...................... A  (minor bump, @noormdev/sdk — new public API)
```


## Outline

```
src/sdk/context.ts
  withSchema — validate `name`, derive a sibling Context sharing #state and #heldConnections, schema replaces (never stacks) any parent schema
    identifier validation — rejects unsafe schema names before deriving, same posture as impersonate's validateUsername (src/sdk/impersonate/dialect-strategy.ts:33)
  kysely (getter) — re-derives against the current schema on every access; never caches the wrapped instance
  proc / func / tvf — prefix `${schema}.${name}` unless `name` already contains a `.`, then delegate to the existing builders (buildProcCall/buildFuncCall/buildTvfCall, src/sdk/sql.ts) unchanged

tests/sdk/with-schema.test.ts
  kysely getter qualifies compiled SQL with the derived schema
  chained withSchema calls replace rather than stack
  proc/func/tvf prefix unqualified names; already-dotted names pass through unchanged
  invalid schema name throws synchronously, no state mutated
  #heldConnections shared — a scope opened via a derived context is releasable through the parent

tests/integration/sdk/with-schema.test.ts
  schema-scoped queries resolve against the target schema across postgres/mysql/mssql/sqlite
  transaction() inherits schema scoping from a derived context
  impersonate() composes with a derived context — the impersonated scope's kysely/proc/func/tvf resolve against the schema
  parent.disconnect() releases a held connection opened through a derived context

packages/sdk/README.md
  Schema scoping — withSchema usage example, same-pool/same-lifecycle framing, raw-sql caveat

docs/reference/sdk.md
  withSchema(name) — API reference: derivation semantics, replace-not-stack, proc/func/tvf prefixing, transaction/impersonation composition, raw-sql caveat, non-goals

.changeset/sdk-with-schema.md
  None — changeset frontmatter + summary, no nameable pieces
```


## Flows

```
Flow: deriving a schema-scoped context
1. caller calls ctx.withSchema<SDB>('acct') on a parent Context (connected or not)
2. withSchema validates 'acct' as a sane identifier — an invalid name throws synchronously, no state touched
3. withSchema constructs a derived Context sharing the parent's #state (same connection reference) and #heldConnections Set, with schema set to 'acct' — replacing, never stacking, any schema the parent already carried
4. caller receives the derived Context, typed Context<SDB, SProcs, SFuncs, STvfs>

Flow: query builder access through a schema-scoped context
1. caller reads derived.kysely
2. the getter resolves the bare Kysely instance off the shared #state.connection
3. because a schema is set, the getter re-derives fresh on every access rather than caching a wrapped instance
4. queries run through the derived instance resolve against 'acct'; queries run through the parent (or a sibling derived with a different schema) resolve against the parent's own schema, or none

Flow: routine call through a schema-scoped context
1. caller calls derived.proc('rebuild_ledger', params) (or .func / .tvf)
2. Context checks whether the name contains '.': it does not, so it prefixes with the schema -> 'acct.rebuild_ledger'
3. the qualified name passes unchanged into the existing buildProcCall/buildFuncCall/buildTvfCall builders, which split on '.' and quote each segment per dialect (quoteIdent, src/sdk/sql.ts:35)
4. if the caller passed an already-qualified name ('other_schema.rebuild_ledger'), the schema prefix step is skipped and the caller's qualification is used unchanged

Flow: transaction and impersonation composition
1. caller calls derived.transaction(fn) or derived.impersonate(username, fn)
2. transaction() calls this.kysely.transaction() — the transaction stays schema-scoped, resolving against 'acct' the same as the context it was opened from
3. impersonate() calls this.kysely.connection() — the pinned connection stays schema-scoped too, so the returned scope's proc/func/tvf calls resolve against 'acct'
4. both paths read/write the parent's shared #heldConnections Set, so disconnect() on either instance drains scopes opened through the other
```


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Implement `Context.withSchema`: identifier validation, `kysely` getter re-derivation, `proc`/`func`/`tvf` prefixing, shared `#state`/`#heldConnections` | `src/sdk/context.ts`, `tests/sdk/with-schema.test.ts` | atomic-implementer (mode: feature) | 2 | `tests/sdk/with-schema.test.ts` green — compiled-SQL qualification, replace-not-stack, prefixing, synchronous validation failure, shared `#heldConnections` |
| 2 | Integration coverage: schema-scoped queries, transaction and impersonation composition, cross-dialect | `tests/integration/sdk/with-schema.test.ts` | atomic-implementer (mode: feature) | 1 | `tests/integration/sdk/with-schema.test.ts` green against `docker-compose.test.yml` (postgres/mysql/mssql/sqlite) |
| 3 | Document `withSchema` — SDK README, VitePress SDK reference, changeset | `packages/sdk/README.md`, `docs/reference/sdk.md`, `.changeset/sdk-with-schema.md` | atomic-implementer (mode: feature) | 3 | Docs describe the API, the raw-SQL caveat, and all four non-goals; changeset references `@noormdev/sdk` with a `minor` bump |


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| The `kysely` getter caches the wrapped instance instead of re-deriving fresh each access, letting schema stacking or drift survive a reconnect | low | Unit test asserts the getter re-derives from `#state.connection` on every access rather than caching the wrapped instance |
| Schema-name validation is too permissive (admits characters that don't belong in an unparameterized identifier position) or too restrictive (rejects legitimate schema names) | med | Mirror `validateUsername`'s allow-list posture (`src/sdk/impersonate/dialect-strategy.ts:33`); unit test covers valid/invalid boundary cases |
| Cross-dialect integration coverage for transaction/impersonation composition is uneven because mysql/sqlite already reject some routine kinds (per existing dialect gates in `src/sdk/sql.ts`), risking incomplete or falsely-green assertions | med | Scope routine-composition assertions to dialects that already support the routine kind; assert query-builder + transaction schema-qualification uniformly across all four dialects regardless |
| The raw-`sql` caveat goes unnoticed and users assume `withSchema` rewrites raw fragments | low | Explicit non-goal plus a documented caveat in both `packages/sdk/README.md` and `docs/reference/sdk.md` |


## Change log

<!-- Populated on first amendment after the spec is approved. Do not log drafting/refinement turns. -->
