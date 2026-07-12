# Spec: v1-14 SDK type surface hardening

Ticket: `tickets/v1/14-sdk-type-hardening.md`. Evidence: `research/v1-audit/v1-release/sdk-api-surface.md`
(VR-api-04 the `_buildFn` public setter, VR-api-05 the 11 uncurated leaked types).

## Stacked branch

Base: `v1/25-sdk-contract` @ `43aa192`, not `master`. Worktree: `.worktrees/v1-14-sdk-types`
on branch `v1/14-sdk-types`. Ticket 25 rewrote the SDK failure contract and already touches
`src/sdk/index.ts` (added `NotConnectedError`/`VaultAccessError` to the guard-error export
block) and `src/sdk/namespaces/db.ts` (`#kysely` getter now calls `requireConnection(state)`).
This spec's changes land in the same two files at different locations (the "Types" export
block in `index.ts`; the constructor/build-injection section in `db.ts`), so stacking avoids a
merge conflict and builds on 25's already-reviewed contract. Reviewers diff against `43aa192`,
not `master` — `git diff 43aa192...HEAD`.

## Goal

Close two pre-v1 API-hygiene gaps in the shipped `@noormdev/sdk` type surface:

1. `DbNamespace` exposes a publicly-callable `set _buildFn(...)` (tagged `@internal`, which is
   a no-op — no `stripInternal` anywhere in the build). Any consumer holding a `DbNamespace`
   instance can do `ctx.noorm.db._buildFn = whatever`, hijacking what `db.reset()` runs after
   teardown. Remove the setter; wire the build function through the constructor instead, once,
   at construction time in `NoormOps`.
2. `src/sdk/index.ts`'s curated "Types" export section only re-exports 3 of the 14 types that
   `DbNamespace`'s public method signatures actually reference (`TableSummary`, `TableDetail`,
   `ExploreOverview`). The other 11 (10 explore Summary/Detail types + `TruncateOptions`)
   already ship in the built `.d.ts` today — `dts-bundle-generator` hoists them regardless of
   curation, because it must fully resolve every exported class's method signatures. Make the
   curation real: explicitly enumerate and re-export all 11, and review each for internal-only
   fields that shouldn't freeze into the public semver contract.

## Non-goals

- The SDK failure-contract question (tuples vs. throws, D1) — ticket 25, already merged onto
  this branch's base. Not touched here.
- `ctx.noorm.observer` singleton relocation (D5) — ticket 33.
- `src/sdk/types.ts`'s `ExportOptions`/`ImportOptions` JSDoc `@example` drift (VR-api-03) —
  ticket 07's scope. 25 already flagged this as a 07/25 textual overlap on the two `@example`
  blocks it touched; this ticket does not touch `types.ts` at all, so there is no further
  overlap to reconcile here.
- `ColumnDetail` and `ParameterDetail` (`src/core/explore/types.ts`) — **discovered during
  baseline verification, not in the ticket's named 11.** Both are already hoisted as top-level
  `export interface` in the shipped `.d.ts` today (confirmed pre-change: `packages/sdk/dist/
  index.d.ts:2428,2439`), reached via `TableDetail.columns`/`ViewDetail.columns`/
  `TypeDetail.attributes` (`ColumnDetail`) and `ProcedureDetail.parameters`/
  `FunctionDetail.parameters` (`ParameterDetail`). Same unreviewed-leak pattern VR-api-05
  describes, one level deeper. Not fixed here — the ticket's acceptance criteria and evidence
  cite exactly 11 named types; expanding the list is a judgment call for a follow-up, not a
  silent scope add. Logged as a FOLLOWUPS entry for user disposition at finalize.
- The pre-existing `Lock`/`LockOptions` name-collision warning `dts-bundle-generator` emits on
  every build (`core/lock/types.ts` vs. the SDK's own `Lock`-adjacent surface) — unrelated to
  the explore/teardown types this ticket curates, predates this change, not touched.

## Success criteria

Ticket acceptance criteria, verbatim:

- [ ] No public mutation path to swap internal functions on a live context (compile-time check
      or test).
- [ ] Every type reachable from the shipped `.d.ts` is explicitly exported and was reviewed
      (list them in the PR body).

Concrete, verifiable form of the above for this spec:

- [ ] `set _buildFn` no longer exists anywhere on `DbNamespace` — proven by a runtime test
      asserting `Object.getOwnPropertyDescriptor(DbNamespace.prototype, '_buildFn')` is
      `undefined`, and confirmed absent from the built `.d.ts` after `bun run build:packages`.
- [ ] `db.reset()` still forces a rebuild after teardown, now wired via a constructor
      parameter (`NoormOps.get db()` passes it once at construction) — proven by a test that
      constructs `DbNamespace` with an injected build fn and asserts it runs on `reset()`.
- [ ] All 11 types (`ViewSummary`, `ProcedureSummary`, `FunctionSummary`, `TypeSummary`,
      `IndexSummary`, `ForeignKeySummary`, `ViewDetail`, `ProcedureDetail`, `FunctionDetail`,
      `TypeDetail`, `TruncateOptions`) are explicit `export type` statements in
      `src/sdk/index.ts`, each reviewed per the table below.
- [ ] `bun run typecheck`, `bun run lint`, `bun run build`, `bun run build:packages` all green.
- [ ] `packages/sdk/dist/index.d.ts` (post `build:packages`) greped to confirm: zero
      `_buildFn` occurrences; all 11 type names present as top-level `export interface`.

## Approaches

**_buildFn removal:**

| Approach | Outcome |
|---|---|
| **Constructor injection (chosen)** | Add an optional 2nd constructor param to `DbNamespace`; `NoormOps` passes `(opts) => this.run.build(opts)` once at construction. No property, public or private-but-settable, is ever exposed post-construction. |
| Keep the setter, rename to look more private | Rejected — `@internal` is already a no-op here; a differently-named setter is exactly as publicly callable as `_buildFn` is today. Doesn't fix the finding. |
| `WeakMap<DbNamespace, BuildFn>` side-channel keyed by instance | Rejected — overengineered. The constructor already threads `state` through; a second param is the minimum-code fix (YAGNI ladder step 6). |

**Type curation:**

| Approach | Outcome |
|---|---|
| **Explicit `export type` list (chosen)** | Matches the existing curated-export pattern already used for `TableSummary`/`TableDetail`/`ExploreOverview` — just complete it. Self-documenting: the list in `index.ts` *is* the reviewed contract. |
| Configure `dts-bundle-generator` to silently export everything referenced | Rejected — defeats the goal. The point is a deliberate, reviewed list, not maximal auto-inclusion. |
| Leave uncurated, tell consumers to import from `core/explore/types.js` directly | Rejected — doesn't fix anything; the types already leak into the public `.d.ts` today regardless (dts-bundle-generator hoists referenced types independent of curation), so this "fix" would just add an alternate uncurated import path on top of the existing leak. |

## Change tree

```
src/sdk/namespaces/db.ts ................... M  (constructor: 2nd optional buildFn param; delete `set _buildFn`)
src/sdk/noorm-ops.ts ......................... M  (db getter: pass buildFn to constructor, not post-construction assignment)
src/sdk/index.ts ............................. M  (explicit re-export of the 11 explore/teardown types)
tests/sdk/db-namespace.test.ts ............... M  (setter-gone guard + constructor-injection behavior test)
tests/sdk/dts-surface.test.ts ................ A  (new: built-.d.ts grep assertions, mirrors bundle-smoke.test.ts's skip-if-absent idiom)
tests/integration/sdk/db-reset.test.ts ....... M  (required collateral: only call site outside noorm-ops.ts using the removed setter)
docs/spec/v1-14-sdk-types.md ................. A  (this spec)
```

## Outline

```
src/sdk/namespaces/db.ts
  DbNamespace
    constructor — accepts (state, buildFn?); stores buildFn in #buildFn
    (removed) set _buildFn — deleted; no public mutation path remains

src/sdk/noorm-ops.ts
  NoormOps.get db() — constructs DbNamespace with the build closure inline, once

src/sdk/index.ts
  Types re-export block — 11 new explicit `export type` names (explore: 10, teardown: 1)

tests/sdk/db-namespace.test.ts
  'should not expose a public _buildFn setter' — prototype descriptor assertion
  'should invoke the constructor-injected build fn on reset()' — behavior test

tests/sdk/dts-surface.test.ts
  'shipped .d.ts has no _buildFn setter'
  'shipped .d.ts exports all 11 curated explore/teardown types as top-level interfaces'

tests/integration/sdk/db-reset.test.ts
  'reset() ignores preserveTables...' — buildFn now passed via DbNamespace constructor
```

## Flows

Flow: `db.reset()` build-fn wiring, constructor-time only
1. `NoormOps.get db()` constructs `new DbNamespace(state, (opts) => this.run.build(opts))` on
   first access.
2. `DbNamespace` stores the closure in `#buildFn` (true private field — inaccessible outside
   the class, unlike the old `_buildFn` which was a public accessor).
3. `db.reset()` calls `this.#buildFn?.({ force: true })` after teardown, same as today. No
   external code can observe, read, or replace `#buildFn` after construction.

Flow: shipped type surface curation
1. Consumer imports `@noormdev/sdk`; TS resolves the public `.d.ts`, which today is a mix of
   `src/sdk/index.ts`'s explicit `export type` statements plus whatever `dts-bundle-generator`
   additionally hoists because a curated class's method signature references it.
2. This ticket adds 11 explicit `export type` lines so those 11 types are public because the
   SDK authors reviewed and said so — not as a side effect of a generator's reachability walk.
3. `bun run build:packages` + `tests/sdk/dts-surface.test.ts` confirm both facts mechanically:
   no orphaned `_buildFn` setter, all 11 names present as top-level `export interface`.

## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Remove public `_buildFn` setter; inject build fn via `DbNamespace` constructor | `src/sdk/namespaces/db.ts`, `src/sdk/noorm-ops.ts`, `tests/sdk/db-namespace.test.ts`, `tests/integration/sdk/db-reset.test.ts` | atomic-implementer (mode: surgical) | 2 src (+2 test) | prototype-descriptor test fails pre-fix / passes post-fix; `reset()` still forces rebuild; `bun run typecheck` green |
| 2 | Explicitly re-export + review the 11 curated types; add `.d.ts` regression test | `src/sdk/index.ts`, `tests/sdk/dts-surface.test.ts` | atomic-implementer (mode: surgical) | 1 src (+1 test) | `bun run build:packages` then grep confirms 11 `export interface` present + 0 `_buildFn` occurrences |

## Type review — the 11 curated types

Reviewed against `src/core/explore/types.ts` and `src/core/teardown/types.ts` (source of
truth; the `.d.ts` re-declares these verbatim, no shape drift possible through
`dts-bundle-generator`).

| Type | Fields | Internal-only fields? | Verdict |
|---|---|---|---|
| `ViewSummary` | `name, schema?, columnCount, isUpdatable` | None | Ship as-is — plain introspection metadata, already how `TableSummary` (precedent) looks. |
| `ProcedureSummary` | `name, schema?, parameterCount` | None | Ship as-is. |
| `FunctionSummary` | `name, schema?, parameterCount, returnType` | None | Ship as-is. |
| `TypeSummary` | `name, schema?, kind: 'enum'\|'composite'\|'domain'\|'other', valueCount?` | None | Ship as-is — `kind` is a closed literal union, stable. |
| `IndexSummary` | `name, schema?, tableName, tableSchema?, columns, isUnique, isPrimary` | None | Ship as-is. |
| `ForeignKeySummary` | `name, schema?, tableName, tableSchema?, columns, referencedTable, referencedSchema?, referencedColumns, onDelete?, onUpdate?` | None | Ship as-is — standard FK metadata. |
| `ViewDetail` | `name, schema?, columns: ColumnDetail[], definition?, isUpdatable` | `definition` carries the view's raw SQL body | Ship as-is — that's the intended payload of `describeView()`, not an internal leak. Same shape class as `TableDetail` (existing precedent). Note: `columns: ColumnDetail[]` references a type not in this curated list — see Non-goals (`ColumnDetail` follow-up). |
| `ProcedureDetail` | `name, schema?, parameters: ParameterDetail[], definition?` | `definition` = raw SQL body | Ship as-is, same reasoning. `parameters: ParameterDetail[]` — same follow-up note as above. |
| `FunctionDetail` | `name, schema?, parameters, returnType, definition?, language?` | `definition` = raw SQL body | Ship as-is. |
| `TypeDetail` | `name, schema?, kind, values?, attributes?: ColumnDetail[], baseType?, definition?` | `definition` = raw SQL body | Ship as-is. |
| `TruncateOptions` | `preserve?, only?, restartIdentity?, dryRun?` | None | Ship as-is — already the parameter type of the already-public `db.truncate()`; no internal fields, all consumer-facing knobs. |

No field across the 11 is internal-only or needs reshaping before v1 freezes it. The
`definition` fields (raw SQL source text) are the intended value of the `describeX()` calls,
not accidental exposure. The one genuine gap found during review — `ColumnDetail` and
`ParameterDetail` referenced by these types but not themselves curated — is documented under
Non-goals as a discovered-not-fixed follow-up.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Removing the setter breaks a consumer relying on it | low | Repo-wide grep before starting found exactly 3 call sites: `noorm-ops.ts` (the intended wiring, converted to constructor), and 2 test files (`tests/integration/sdk/db-reset.test.ts`, fixed as required collateral; no `tests/sdk/*` unit test used it). No `examples/` or `packages/` reference. |
| `dts-bundle-generator` renames/collides one of the 11 on re-export | low | Baseline build already shows one unrelated pre-existing collision (`Lock`/`LockOptions` vs. `core/lock/types.ts`) — different domain, no name overlap with the explore/teardown types. Post-change grep verification checks exact names. |
| `ColumnDetail`/`ParameterDetail` leak un-reviewed (confirmed present) | confirmed | Explicitly out of the ticket's named 11; documented in Non-goals; FOLLOWUPS entry raised for user disposition, not silently fixed or silently ignored. |

## Change log

## Implementation log

### shipped (pending user ship decision) — 2026-07-12

Built across 2 iterations of `/subagent-implementation` (2 implement→review cycles, both PASS
on first pass). Stacked on `v1/25-sdk-contract` @ `43aa192`. Commits (chronological):

- `928d862` — docs(spec): this spec
- `6df7718` — CP1: removed public `_buildFn` setter on `DbNamespace`; constructor injection
  wired once in `NoormOps.get db()`; fixed the one other call site
  (`tests/integration/sdk/db-reset.test.ts`) using the removed setter
- `113e39c` — CP2: explicit `export type` for the 11 curated explore/teardown types in
  `src/sdk/index.ts`; new `tests/sdk/dts-surface.test.ts` regression guard against the built
  `.d.ts`

**Out-of-scope work performed during this build:**

- `tests/integration/sdk/db-reset.test.ts` — required collateral, not optional. The only call
  site outside `noorm-ops.ts` using the removed `_buildFn` setter; `bun run typecheck` breaks
  without this update. Switched to passing the build fn as the constructor's 2nd arg; not
  executed (needs a live postgres container, out of this loop's scope).

**Unforeseens — surprises that emerged during implementation:**

- Baseline verification (before iteration 1) found `ColumnDetail`/`ParameterDetail` already
  leaking into the shipped `.d.ts` unreviewed, same VR-api-05 pattern as the 11 named types but
  not in the ticket's literal list. Not expanded into scope — documented in the spec's
  Non-goals and raised as FOLLOWUPS F-1 for user disposition, per the orchestrator's
  "report before expanding" guidance rather than silently growing the diff.
- `bun run typecheck:tests` (not in the mandated command set) surfaces one pre-existing error
  in `tests/sdk/db-namespace.test.ts:104` (`ConnectionResult.destroy` missing from a fixture
  object) — confirmed present at the base commit `43aa192`, in a fixture this ticket's diff
  never touches (only appended new `describe` blocks after line 256). Pre-existing from ticket
  25's `ConnectionResult` shape change, not introduced here, not fixed here.
- The orchestrator's first attempt at committing the spec accidentally swept the already-staged
  CP1 code changes into the same commit (`git commit` with no pathspec commits all staged
  changes, not just the newly `git add`-ed file). Caught immediately via `git show --stat`,
  fixed with `git reset --soft HEAD~1` + `git reset HEAD` + re-committing in two correctly
  scoped commits. No user-visible impact — corrected before any push.

**Deferred items still open:**

- FOLLOWUPS F-1 (🟡): `ColumnDetail`/`ParameterDetail` unreviewed leak — same treatment as the
  11 curated types, candidate for a fast-follow ticket.
- FOLLOWUPS F-2 (🔵): pre-existing `Lock`/`LockOptions` name-collision warning from
  `dts-bundle-generator` — cosmetic, unrelated to this ticket's domain, noted for awareness.
- Both left open pending user disposition (fix-now / defer / issue / drop) — not auto-decided.
