# Spec: v1-40 ColumnDetail + ParameterDetail leaked SDK types

Ticket: `tickets/v1/40-columndetail-parameterdetail-leak.md`. Evidence: `research/v1-audit/v1-release/sdk-api-surface.md`
(VR-api-05, one level deeper — the same pattern ticket 14 curated for 11 types).

## Stacked branch

Base: `v1/14-sdk-types` @ `443929c`, not `master`. Worktree: `.worktrees/v1-40-column-detail`
on branch `v1/40-column-detail`. Ticket 14 curated the SDK's explore/teardown type surface and
explicitly documented `ColumnDetail`/`ParameterDetail` as a discovered-not-fixed follow-up
(spec Non-goals, FOLLOWUPS F-1) — those two types are referenced by fields on 4 of the 11 types
14 already curated (`TableDetail.columns`, `ViewDetail.columns`, `TypeDetail.attributes`,
`ProcedureDetail.parameters`, `FunctionDetail.parameters`), so this ticket stacks directly on
14's already-reviewed curation rather than re-deriving it. Reviewer diffs against `443929c`,
not `master` — `git diff 443929c...HEAD`.

## Goal

Close the one remaining pre-v1 API-hygiene gap ticket 14 flagged but explicitly left out of
its named 11: `ColumnDetail` and `ParameterDetail` (`src/core/explore/types.ts`) are already
hoisted into the shipped `.d.ts` by `dts-bundle-generator` (confirmed pre-change at
`packages/sdk/dist/index.d.ts:2428,2439` — same line numbers ticket 14's spec cited, unchanged
since) because they're referenced by curated Detail types' fields. Explicitly re-export both
from `src/sdk/index.ts` (making the inclusion intentional, not a generator side effect), review
each for internal-only fields, and extend the existing `.d.ts` regression test.

## Non-goals

- Any of the 11 types ticket 14 already curated and reviewed — done work, not re-litigated
  here.
- `_buildFn` setter removal (VR-api-04) — ticket 14, already merged onto this branch's base.
- The pre-existing `Lock`/`LockOptions` name-collision warning `dts-bundle-generator` emits on
  every build — unrelated, predates this change, already logged as ticket 14's FOLLOWUPS F-2.
  Confirmed still present in this ticket's baseline build, unchanged.

## Success criteria

Ticket acceptance criteria, verbatim:

- [ ] Both types explicitly exported and reviewed (list the verdict per type in the PR body).
- [ ] `.d.ts` shows them as intentional top-level exports.

Concrete, verifiable form of the above for this spec:

- [ ] `ColumnDetail` and `ParameterDetail` are explicit `export type` names in
      `src/sdk/index.ts`'s existing curated explore-types block, each reviewed per the table
      below.
- [ ] `bun run typecheck`, `bun run lint`, `bun run build`, `bun run build:packages` all green.
- [ ] `packages/sdk/dist/index.d.ts` (post `build:packages`) greped to confirm both names
      present as top-level `export interface` (already true today via generator hoisting —
      this ticket makes it a reviewed, intentional export rather than a side effect).
- [ ] `tests/sdk/dts-surface.test.ts` extended with both names in the curated-types regression
      list.

## Approaches

| Approach | Outcome |
|---|---|
| **Add to existing curated `export type` list (chosen)** | `ColumnDetail`/`ParameterDetail` already live in the same source module (`core/explore/index.js`) as the 11 types ticket 14 curated, and that module already re-exports both (`src/core/explore/index.ts:29-30`). Adding two names to the existing `export type { ... } from '../core/explore/index.js'` block in `src/sdk/index.ts` is the minimum-code fix — same pattern, same file, same import source. |
| Separate `export type` statement just for these two | Rejected — no reason to split from the existing block; they come from the same module and the same review pass ticket 14 established for the other 11. |
| Leave uncurated | Rejected — doesn't fix anything; they already leak into the public `.d.ts` today regardless (dts-bundle-generator hoists referenced types independent of curation), same reasoning ticket 14's spec used to reject this option for the original 11. |

## Change tree

```
src/sdk/index.ts ............................. M  (add ColumnDetail, ParameterDetail to the existing curated explore-types export block)
tests/sdk/dts-surface.test.ts ................ M  (extend curatedTypes list with both names)
docs/spec/v1-40-column-detail.md ............. A  (this spec)
```

## Outline

```
src/sdk/index.ts
  Types re-export block (the same `export type { ... } from '../core/explore/index.js'`
  block ticket 14 populated) — add ColumnDetail, ParameterDetail

tests/sdk/dts-surface.test.ts
  'sdk .d.ts: curated type exports' — curatedTypes array gains ColumnDetail, ParameterDetail
```

## Flows

Flow: shipped type surface curation (continuation of ticket 14's)
1. Consumer imports `@noormdev/sdk`; TS resolves the public `.d.ts`.
2. `ColumnDetail`/`ParameterDetail` are already present in the built `.d.ts` today (generator
   hoists them via `TableDetail.columns` et al.), but with no explicit re-export in
   `src/sdk/index.ts` and no reviewed verdict — an accidental leak, same as the original 11
   were before ticket 14.
3. This ticket adds both to the existing curated `export type` block, closing the gap ticket 14
   flagged and deferred. `bun run build:packages` + the extended `dts-surface.test.ts` confirm
   mechanically: both names present as top-level `export interface`.

## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Explicitly re-export + review `ColumnDetail`/`ParameterDetail`; extend `.d.ts` regression test | `src/sdk/index.ts`, `tests/sdk/dts-surface.test.ts` | atomic-implementer (mode: surgical) | 1 src (+1 test) | `bun run build:packages` then grep confirms both `export interface` present; extended test passes |

## Type review — ColumnDetail + ParameterDetail

Reviewed against `src/core/explore/types.ts` (source of truth; the `.d.ts` re-declares these
verbatim, no shape drift possible through `dts-bundle-generator`). Same internal-only-fields
bar ticket 14 applied to the original 11.

| Type | Fields | Internal-only fields? | Verdict |
|---|---|---|---|
| `ColumnDetail` | `name, dataType, isNullable, defaultValue?, isPrimaryKey, ordinalPosition` | None | Ship as-is — plain column introspection metadata (name/type/nullability/default/PK flag/position). Already the intended payload of `TableDetail.columns`/`ViewDetail.columns`/`TypeDetail.attributes`, all of which ticket 14 already reviewed and shipped. No raw-SQL or internal-wiring field present. |
| `ParameterDetail` | `name, dataType, mode: 'IN'\|'OUT'\|'INOUT', defaultValue?, ordinalPosition` | None | Ship as-is — plain parameter introspection metadata. `mode` is a closed literal union, stable. Already the intended payload of `ProcedureDetail.parameters`/`FunctionDetail.parameters`, both already reviewed and shipped by ticket 14. |

No field on either type is internal-only or needs reshaping before v1 freezes it. This closes
the gap ticket 14's spec documented under Non-goals and FOLLOWUPS F-1.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `dts-bundle-generator` renames/collides either type on explicit re-export | low | Both already ship today as top-level `export interface` via generator hoisting (confirmed baseline: `packages/sdk/dist/index.d.ts:2428,2439`); making the export explicit doesn't change what the generator resolves, only whether `src/sdk/index.ts` says so intentionally. Post-change grep verification checks exact names. |
| Scope creep into re-reviewing the 11 types ticket 14 already shipped | low | Explicitly out of scope — see Non-goals. This spec's diff touches only the two new names. |

## Change log
