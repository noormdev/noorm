# Spec: v1-33 relocate the event bus — `ctx.noorm.observer` → `noormObserver`

Ticket: `tickets/v1/33-noorm-observer-relocation.md`. Evidence: `research/v1-audit/v1-release/sdk-api-surface.md`
(VR-api-09). Decision: `tickets/v1/00-DECISIONS.md` D5 — RULED 2026-07-11: relocate, named
`noormObserver`.

## Stacked branch

Base: `v1/14-sdk-types` @ `443929c`, not `master`. Worktree: `.worktrees/v1-33-observer` on
branch `v1/33-observer`. The SDK track stacks 08 → 25 → 14 → this ticket. Ticket 25 rewrote the
SDK failure contract and deliberately preserved `ctx.noorm.observer` as a named carve-out
(`docs/spec/v1-25-sdk-contract.md`'s carve-out table: "`ctx.noorm.observer` | `noorm-ops.ts:91-95`
| D5, ticket 33."). Ticket 14 hardened the type surface (`_buildFn` setter removal, curated type
exports) and also lists this relocation under its own Non-goals. Both prior tickets touch
`src/sdk/noorm-ops.ts` and `src/sdk/index.ts` — the same two files this ticket edits, at
different locations — so stacking avoids a merge conflict and builds on already-reviewed work.
Reviewers diff against `443929c`, not `master`: `git diff 443929c...HEAD`.

## Goal

`ctx.noorm.observer` is a bare passthrough getter (`src/sdk/noorm-ops.ts:91-95`) shaped like a
per-`Context` accessor but returning the single module-scope `ObserverEngine` singleton from
`src/core/observer.ts` regardless of which config created the `NoormOps` instance. A process
that calls `createContext()` more than once (e.g. a server juggling several tenant databases)
gets one shared event bus across all contexts, with no isolation — the placement through
`ctx.noorm.` implies scope that doesn't exist.

D5's investigation found nothing today exercises multi-context isolation — all documented usage
is single-context progress subscription, and every event payload already carries `configName`
(25 references in `core/observer.ts`), so consumers *can* filter when they need to. The lie is
placement, not usage. **Relocate rather than scope**: remove the `ctx.noorm.observer` accessor
and export the bus as a top-level SDK export named `noormObserver`, which is self-describingly
process-global. Zero behavior change — same `ObserverEngine` instance, same events, new access
path.

## Non-goals

- A per-context filtered relay (e.g. `ObserverRelay` scoped by `configName`) — D5 records this
  as an additive, non-breaking, post-v1 feature under its own name. `noormObserver` stays
  reserved for the process-global bus; no naming collision to walk back later.
- The broader doc/skill error-contract contradiction sweep (tuples vs. throws teaching) —
  ticket 26's scope. This ticket only touches the `ctx.noorm.observer` → `noormObserver`
  references it is directly responsible for breaking, in the files the ticket names plus any
  example that would otherwise ship a broken reference.
- Any change to `core/observer.ts` itself (`NoormEvents`, event payload shapes, the
  `ObserverEngine` instance, the `NOORM_DEBUG` spy). The singleton is untouched; only its public
  access path moves.
- Re-litigating D1 (throw vs. tuple) — irrelevant here; `noormObserver.on()` is an
  `ObserverEngine` method, not a noorm SDK method, and is out of D1's boundary.

## Success criteria

Ticket acceptance criteria, verbatim:

- [ ] `ctx.noorm.observer` no longer exists in source or the shipped `.d.ts`; `noormObserver` is
      importable and typed as the NoormEvents engine.
- [ ] `rg 'noorm\.observer'` over src/, docs/, skills/, examples/ returns 0.
- [ ] A future per-context relay remains additive (no naming collision reserved: `noormObserver`
      is the global; scoped API gets its own name later).

Concrete, verifiable form of the above for this spec:

- [ ] `get observer()` deleted from `NoormOps` (`src/sdk/noorm-ops.ts`); the now-unused
      `import { observer } from '../core/observer.js'` in that file is removed too (no other
      use in the file).
- [ ] `src/sdk/index.ts` gains `export { observer as noormObserver } from '../core/observer.js'`
      with JSDoc stating (a) process-global semantics — one instance shared across every
      `Context`/config in the process, not per-context — and (b) that event payloads carry
      `configName` for multi-context filtering.
- [ ] A new SDK unit test asserts `noormObserver` is importable from the SDK entry point and is
      an instance of `ObserverEngine` (the same shape as `NoormEvents`); a second assertion
      (grep or compile-time) confirms `ctx.noorm.observer` no longer exists on `NoormOps`.
- [ ] `bun run build:packages` succeeds and `packages/sdk/dist/index.d.ts` greps confirm:
      zero `observer` occurrences under the `NoormOps`/`DbNamespace`-adjacent getters block,
      and `noormObserver` present as a top-level export typed against `ObserverEngine<NoormEvents>`.
- [ ] `rg 'noorm\.observer'` across `src/`, `docs/`, `skills/`, `examples/` returns 0 matches.

## Approaches

| Approach | Outcome |
|---|---|
| **Top-level re-export, same singleton (chosen)** | `export { observer as noormObserver } from '../core/observer.js'` in `src/sdk/index.ts`; delete the `NoormOps` getter. Zero behavior change, S effort, matches D5's ruling exactly. |
| Per-context scoped `ObserverRelay` | Rejected for this ticket — D5 explicitly defers this post-v1 as an additive feature under a new name; nothing today exercises multi-context isolation, so building the scoping machinery now is speculative (YAGNI ladder step 1: does it need to exist yet?). |
| Keep `ctx.noorm.observer` as a deprecated alias alongside the new export | Rejected — the finding is that the *placement* misleads; keeping the misleading placement around (even deprecated) doesn't fix VR-api-09. Pre-v1, so no semver deprecation window is owed. |

## Change tree

```
src/sdk/noorm-ops.ts .......................................... M  (delete `get observer()`; drop the now-unused `observer` import)
src/sdk/index.ts .............................................. M  (add `export { observer as noormObserver }` with JSDoc)
tests/sdk/*.test.ts (new or existing observer/index surface test) . A/M  (noormObserver importable + typed; ctx.noorm.observer gone)
docs/reference/sdk.md ......................................... M  (event-subscription example: ctx.noorm.observer → noormObserver)
docs/dev/sdk.md ................................................ M  (event-subscription example: ctx.noorm.observer → noormObserver)
skills/noorm/references/sdk.md ................................ M  ("Observer Events" section: 7 call sites → noormObserver)
examples/llm-memory-db-pg/tests/integration/01_observer.test.ts . M  (import noormObserver from @noormdev/sdk; 6 call sites + describe names)
examples/llm-memory-db-mssql/tests/integration/observer.test.ts . M  (import noormObserver from @noormdev/sdk; 5 call sites + header comment)
examples/llm-memory-db-pg/REPORT.md ............................ M  (prose mention of `ctx.noorm.observer` in coverage stats)
docs/spec/v1-33-observer.md .................................... A  (this spec)
```

## Outline

```
src/sdk/noorm-ops.ts
  NoormOps
    (removed) get observer() — deleted; no replacement member
    import { observer } from '../core/observer.js' — removed (no longer referenced)

src/sdk/index.ts
  new export block (near the existing "Re-export observer types for event subscriptions" line)
    /** JSDoc: process-global semantics, configName filtering */
    export { observer as noormObserver } from '../core/observer.js'

tests/sdk/*.test.ts
  'noormObserver is importable from the SDK entry and is an ObserverEngine instance'
  'ctx.noorm.observer no longer exists on NoormOps' (grep-based or property-absence assertion)

docs/reference/sdk.md, docs/dev/sdk.md, skills/noorm/references/sdk.md
  Event Subscriptions / Observer Events sections — `ctx.noorm.observer.on(...)` →
  `noormObserver.on(...)`, with an `import { noormObserver } from '@noormdev/sdk'` line added
  where the surrounding example doesn't already show an import block

examples/llm-memory-db-pg/tests/integration/01_observer.test.ts
examples/llm-memory-db-mssql/tests/integration/observer.test.ts
  add `import { noormObserver } from '@noormdev/sdk'`; replace every `ctx.noorm.observer.on(...)`
  call site with `noormObserver.on(...)`; update `describe()` labels and header comments that
  name the old accessor path

examples/llm-memory-db-pg/REPORT.md
  "Integration coverage" bullet: `ctx.noorm.observer` (4 tests) → `noormObserver` (4 tests)
```

## Flows

Flow: consumer subscribes to core events (new form)
1. `import { noormObserver } from '@noormdev/sdk'` — no `ctx`/`createContext()` needed to reach
   the bus; it exists at module scope before any context is created.
2. `noormObserver.on('file:after', (data) => ...)` — same `ObserverEngine` API as before, same
   `NoormEvents` payload shapes. `data.configName` is present on every context-scoped event for
   callers running more than one `Context` in-process who need to filter to "my" config.
3. Nothing about event emission changes — `core/observer.ts`'s `observer.emit(...)` call sites
   are untouched; only the public re-export path moves.

Flow: `NoormOps` no longer carries the accessor
1. Before: `NoormOps.get observer()` returns the imported `observer` singleton — a property on
   every `ctx.noorm` instance that implied per-context scope it never had.
2. After: `NoormOps` has no `observer` member at all. `ctx.noorm.observer` is `undefined` at
   runtime and a compile error under TypeScript (no such property on the class). Consumers reach
   the bus exclusively through the top-level `noormObserver` import.

## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Relocate the observer: remove `NoormOps.observer`, add top-level `noormObserver` export, sweep every `ctx.noorm.observer` reference (docs, skill, examples) to the new form, add the importability/typing test | `src/sdk/noorm-ops.ts`, `src/sdk/index.ts`, `tests/sdk/*.test.ts`, `docs/reference/sdk.md`, `docs/dev/sdk.md`, `skills/noorm/references/sdk.md`, `examples/llm-memory-db-pg/tests/integration/01_observer.test.ts`, `examples/llm-memory-db-mssql/tests/integration/observer.test.ts`, `examples/llm-memory-db-pg/REPORT.md` | atomic-implementer (mode: feature) | 2 src + 1 test + 3 docs + 3 example files | new test fails pre-fix (`noormObserver` doesn't exist) / passes post-fix; `ctx.noorm.observer` gone from `NoormOps` (compile-time); `bun run typecheck`, `bun run lint`, `bun run build`, `bun run build:packages` all green; `.d.ts` grep confirms `observer` getter gone / `noormObserver` present; `rg 'noorm\.observer'` sweep returns 0 across src/docs/skills/examples |

Single checkpoint — the ticket is S-effort and mechanically cohesive (one relocation, swept
everywhere its old form was documented or exercised). No reason to split a rename-and-sweep into
multiple review rounds.

## Testing scope (centralized — do not run test groups/integration/docker)

Per the ticket's severity and the SDK track's established pattern (see v1-14/v1-25 specs): run
only what proves this ticket's contract, not the full suite.

- The `tests/sdk/*.test.ts` file(s) this checkpoint touches — run directly with `bun test`, not
  the full `tests/sdk` directory sweep, unless the new test is added to an existing file already
  covered by that sweep.
- `bun run typecheck`
- `bun run lint`
- `bun run build`
- `bun run build:packages` — then grep `packages/sdk/dist/index.d.ts` for `observer` (should
  show no `NoormOps`/`DbNamespace`-adjacent getter) and `noormObserver` (should show the new
  top-level export).
- `rg 'noorm\.observer' src docs skills examples` — must return 0 matches (exit 1 from rg, or
  empty output).

Explicitly out of scope: `tests/cli`, `tests/integration` (needs live DBs), the example
projects' own `bun test` runs (also need live DBs) — editing their source is in scope, running
them is not.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| A consumer (outside this repo) depends on `ctx.noorm.observer` | none, pre-v1 | Package has not shipped a v1 release; no semver deprecation window owed. Ticket 25/14 already carved this accessor out as known-temporary. |
| Example test files (`examples/**/tests/integration/*observer*.test.ts`) silently keep using the removed accessor because their own `bun test` isn't run in this loop | medium if unswept | Explicitly in the ticket's prescription ("any example using `ctx.noorm.observer`") and the acceptance criteria's `rg` sweep covers `examples/`. Both files are edited as part of Checkpoint 1, not just grepped. |
| `dts-bundle-generator` names the re-exported const differently than `noormObserver` in the built `.d.ts` | low | Explicit `export { observer as noormObserver }` aliases at the source level — the generator sees and emits the aliased name directly, no inference involved. Verified by the `.d.ts` grep step. |
| Removing the unused `observer` import from `noorm-ops.ts` breaks something else in the file | low | The import's only use was the deleted getter — confirmed by reading the full file before editing; no other reference exists. |

## Change log

## Implementation log
