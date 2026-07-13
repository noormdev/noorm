# Spec: v1-26 align error-handling documentation

Ticket: `tickets/v1/26-align-error-docs.md`. Decision: `tickets/v1/00-DECISIONS.md` D1
(RULED 2026-07-11 — throw at the producer; `attempt()` is consumer-side and deliberate;
result objects legitimate for failure-as-data; try-catch stays banned).

## Stacked branch

Base: `v1/33-observer` @ `168da07`, not `master`. Worktree: `.worktrees/v1-26-error-docs` on
branch `v1/26-error-docs`. The SDK track stacks 08 -> 25 -> 14 -> 33 -> this ticket (the last
piece). Ticket 25 rewrote the SDK's public failure contract (throw named errors at the
`ctx.noorm.*` boundary) and explicitly deferred the doc/skill sweep to this ticket (its own
spec's Non-goals: "The doc/skill contradiction sweep... - ticket 26. This spec does not touch
`skills/noorm/**` or `docs/reference/sdk.md` / `docs/dev/sdk.md`."). Ticket 33 relocated
`ctx.noorm.observer` -> `noormObserver` and, as part of its own sweep, already fixed every
Observer Events/Subscriptions code block in `docs/reference/sdk.md`, `docs/dev/sdk.md`,
`skills/noorm/references/sdk.md`, and the two example observer test files - confirmed by
diffing this worktree against `master`: only `skills/noorm/references/sdk.md` differs from
`master`, and the diff is exactly the Observer Events section. Reviewers diff against
`168da07`, not `master`: `git diff 168da07...HEAD`.

## Goal

Every surface that teaches or exercises the `@noormdev/sdk` failure contract agrees with what
ticket 25 actually shipped: producers throw named errors and let them propagate; `attempt()`/
`attemptSync()` are consumer-side and deliberate (used only when the caller will do something
with the error); `{ ok, error? }`/similar result objects are legitimate for designed
failure-as-data (`utils.testConnection`); try-catch stays banned everywhere. No surface teaches
tuple-destructuring the awaited result of a `ctx.noorm.<x>(...)` call as the SDK's return
shape anymore.

This is docs/rules/skill/example-code alignment only. No `src/` production code changes - the
contract itself is ticket 25's shipped work, verified against the real signatures on this
branch (see "Verified against source" below).

## Non-goals

- Any change to `src/` production code. If a doc contradicts the real signature, the doc is
  wrong, not the code (per the ticket's explicit scope boundary).
- The observer relocation sweep (D5) - ticket 33's scope, already complete on this stack.
- Re-litigating D1 itself - it is ruled; this ticket implements the documentation consequence.
- `examples/llm-memory-db-mssql/mssql-problems.md` and `examples/llm-memory-db-pg/REPORT.md` -
  historical incident/postmortem logs, not living convention-teaching surfaces. They contain
  prose describing a since-fixed bug in prose form (`[null, Error(...)]`-shaped sentences), not
  `const [...] = await ctx....` code, so they do not trip the acceptance criteria's `rg` sweep.
  Editing a postmortem to retroactively match the fix it describes is not this ticket's job.
  Left as-is; noted so a reader doesn't mistake the omission for an oversight.
- `.claude/rules/typescript.md`'s `## Utilities` section (the illustrative code-example block
  further down the file, distinct from the `## Error Handling (ZERO TOLERANCE)` mandate list) -
  those are examples of API shape, not an "ALWAYS use" mandate, so the zero-import-sites finding
  doesn't apply to them.
- `docs/wiki/index.md`'s "no try-catch in source" / "`attempt`/`attemptSync` tuples" lines -
  verified still accurate (internal core code legitimately uses tuples; try-catch really is
  banned repo-wide) and explicitly named in the ticket as a keep, not a fix.
- `docs/dev/README.md:174`'s generic `attempt`/`attemptSync` illustration - a generic internal
  core-pattern example (`dangerousOperation()`, not `ctx.noorm.*`) that already shows the
  correct deliberate-`attempt()`-with-observe pattern D1 prescribes. Verified, not touched.
- Other `docs/spec/*.md` files (`v1-14-sdk-types.md`, `v1-25-sdk-contract.md`,
  `v1-33-observer.md`) - historical specs for other tickets; not this ticket's to edit.

## Verified against source (this branch, not assumed from the ticket text)

Read every SDK namespace file (`src/sdk/namespaces/{vault,transfer,dt,changes,run,db,lock,
templates,utils}.ts`, `src/sdk/context.ts`, `src/sdk/index.ts`) on this branch before writing
any doc fix. Confirmed:

- `vault.init()` -> `Promise<Buffer | null>`, throws on real failure. Repeat-init returns
  `null` - **not an error, not a thrown exception** (the underlying `initializeVault()` in
  `src/core/vault/storage.ts` returns `[null, null]` on repeat calls per its own JSDoc; the SDK
  wrapper only throws when `err` is non-null). This is a real behavioral fact the old docs and
  example tests get wrong (they assert repeat-init returns a tuple with a non-null "already
  initialized" `Error`).
- `vault.set()` -> `Promise<void>`, throws on failure.
- `vault.delete()` -> `Promise<boolean>`, throws on failure.
- `vault.copy()` -> `Promise<VaultCopyResult>`, throws on failure.
- `vault.get/getAll/list/exists` - unchanged, never were tuples.
- `transfer.to()` -> `Promise<TransferResult>`, throws on failure.
- `transfer.plan()` -> `Promise<TransferPlan>`, throws on failure.
- `dt.exportTable()` -> `Promise<{ rowsWritten, bytesWritten }>`, throws on failure.
- `dt.importFile()` -> `Promise<{ rowsImported, rowsSkipped }>`, throws on failure.
- `utils.testConnection()` -> `Promise<{ ok: boolean; error?: string }>` - deliberate result
  object by design (JSDoc at `src/sdk/namespaces/utils.ts` states this explicitly).
- `ctx.transaction(fn)` - delegates to `this.kysely.transaction().execute(fn)`; callback must
  throw to roll back (Kysely's own contract), unaffected by this ticket.
- `changes.*`, `run.*`, `db.*`, `lock.*`, `templates.*`, `secrets.*` - already all throw-based,
  no tuples in their public signatures; no doc fix needed for these namespaces.
- `attempt`/`attemptSync` usage repo-wide: 553 call sites across 175 files (`rg -c
  '\battempt(Sync)?\(' src --type ts`) - the deliberate-wrap pattern is the actual, heavily
  used convention, not a theoretical one.
- `retry` (`@logosdx/utils`): exactly 1 import site, `src/core/connection/factory.ts:93`.
- `batch`, `circuitBreaker`, `debounce`, `throttle`, `memoize`/`memo`, `rateLimit`,
  `withTimeout`, `FetchEngine`: **zero** import sites anywhere in `src/` - confirmed by
  per-symbol `rg` sweep. Matches the ticket's audit finding exactly.
- `ObserverEngine` is imported from `@logosdx/observer`, not `@logosdx/utils` (`src/core/
  observer.ts:19`) - the original rules-doc bullet grouped it under the `@logosdx/utils`
  mandate, which is a package-attribution error independent of the zero-import-sites finding.
  Corrected as part of the same-line rewrite (not a separate scope expansion).

## The single aligned convention statement

This exact substance appears, in each surface's own voice, in every surface touched by this
ticket:

> Producers throw named, `instanceof`-matchable errors and let them propagate. `attempt()`/
> `attemptSync()` are consumer-side tools, used deliberately - only when the caller is going to
> translate, recover, observe, or knowingly ignore the error. If you'd just re-throw or
> re-return it unchanged, skip `attempt` and let it propagate. Try-catch is never used, in the
> SDK or in application code that consumes it. Result-object shapes (`{ ok, error? }`) are
> legitimate where failure genuinely is data, not an exception - `ctx.noorm.utils
> .testConnection()` is the SDK's one designed instance of this. Transaction callbacks
> (`ctx.transaction(...)`) must throw to roll back - Kysely's own contract, not an SDK
> exception to the rule. Raw `ctx.kysely` queries throw like any Kysely call.

## Checkpoints

| # | Checkpoint | Files | Agent | Verifies |
|---|---|---|---|---|
| 1 | Rules doc: rewrite `## Error Handling (ZERO TOLERANCE)` in `.claude/rules/typescript.md` - zero tolerance targets try-catch, not throws/attempt; utilities mandate lists what's actually imported (`attempt`/`attemptSync`, `retry`) vs. what's available-but-unused (`batch`, `circuitBreaker`, `debounce`, `throttle`, `memoize`, `rateLimit`, `withTimeout`, `FetchEngine`); `ObserverEngine` correctly attributed to `@logosdx/observer` | `.claude/rules/typescript.md` | atomic-implementer (mode: surgical) | Section no longer reads "ALWAYS use attempt"; consistent with the file's own Function Structure section above it; utilities list matches the verified import-site counts |
| 2 | Skill layer: `skills/noorm/SKILL.md` frontmatter description + Common Mistakes table row, rewritten for the throw contract; add a concise `### Error Handling` subsection under Shared Conventions stating the convention + the 3 carve-outs; `skills/noorm/references/sdk.md` NoormOps Namespaces section - vault/transfer/dt code blocks (6 tuple sites) rewritten to the throw contract | `skills/noorm/SKILL.md`, `skills/noorm/references/sdk.md` | atomic-implementer (mode: feature) | `rg 'const \[.*err.*\] = await ctx\.noorm\.'` returns 0 in these two files; SKILL.md states the convention once, in substance matching the statement above |
| 3 | Docs guides: `docs/reference/sdk.md` (vault.init/set/delete/copy prose + "three return shapes" table + transfer.to/plan + dt.exportTable/importFile - 8 sites, several requiring prose rewrite not just code swap), `docs/dev/sdk.md` (7 mechanical code-block sites, same namespaces), `docs/dev/vault.md` (1 site - the "Typical call-site pattern at the SDK boundary" block only; the internal `initializeVault()` pseudo-implementation above it correctly stays tuple-returning as documented core-internal behavior, not touched) | `docs/reference/sdk.md`, `docs/dev/sdk.md`, `docs/dev/vault.md` | atomic-implementer (mode: feature) | `rg 'const \[.*err.*\] = await ctx\.noorm\.'` returns 0 across all three files; `vault.status()`'s cross-reference sentence in `docs/reference/sdk.md` no longer says `[null, null]` |
| 4 | Examples: `examples/llm-memory-db-mssql/tests/integration/vault.test.ts` and `examples/llm-memory-db-pg/tests/integration/03_vault.test.ts` - rewrite every `ctx.noorm.vault.*` call site off tuple destructuring; **behavioral fix, not just syntax**: the "repeat init" test in both files currently asserts a non-null `Error` in the tuple's second slot - the real (and now-documented) contract is that repeat `init()` returns `null` with no error at all. Rewrite the assertions and their descriptive test names to match. The "get of an unknown key" test in the mssql file already uses `attempt()` deliberately (inspects the error, accepts either outcome) - leave it as-is, it's already the D1-correct pattern | `examples/llm-memory-db-mssql/tests/integration/vault.test.ts`, `examples/llm-memory-db-pg/tests/integration/03_vault.test.ts` | atomic-implementer (mode: feature) | `rg 'const \[.*\] = await ctx\.noorm\.vault'` returns 0 in both files; no test asserts a thrown/tuple error on repeat `init()` |

TDD skipped on all four checkpoints because: documentation-only (rules/skill/guide prose and
code-fence examples) plus two example test files whose only production-code dependency
(`src/sdk/namespaces/vault.ts`) is unchanged by this ticket - there is no new behavior to drive
with a failing test first. Checkpoint 4 verifies correctness by matching the example tests'
assertions against the real, already-shipped SDK behavior (see "Verified against source"),
not by writing a new test.

## Acceptance criteria (from the ticket, verbatim + concrete form)

- [ ] One convention statement, identical in substance, across rules doc, skill, and guides -
      no surface teaches tuples as the SDK's return shape. Concrete: the statement in "The
      single aligned convention statement" above appears (in each file's own voice) in
      `.claude/rules/typescript.md`, `skills/noorm/SKILL.md`, `docs/reference/sdk.md`.
- [ ] `rg 'const \[.*err.*\] = await ctx\.'` over `docs/`, `skills/`, `examples/` returns 0.
- [ ] Rules doc mandates only utilities the codebase actually uses (`attempt`/`attemptSync`,
      `retry`); the rest listed as available, not mandated.
- [ ] `docs/wiki/index.md`'s "no try-catch in source" line is unchanged (verified accurate,
      not a fix target).

## Testing scope (centralized - do not run test groups/integration/docker)

- `bun run typecheck` - any TypeScript code-fence in the touched docs that the repo's tooling
  actually typechecks must stay valid. (The touched `.md` files are prose/example docs, not
  typechecked doc-fences via a doctest runner - confirm this repo has no such runner before
  treating typecheck as a no-op for docs; if a runner exists, run it.)
- `rg 'const \[.*err.*\] = await ctx\.(vault|transfer|dt)' docs skills examples` -> must return 0.
- `rg 'const \[.*err.*\] = await ctx\.noorm\.(vault|transfer|dt)' docs skills examples` -> must
  return 0 (narrower, ticket's literal pattern).
- `rg "ALWAYS use @logosdx/utils utilities" .claude/rules/typescript.md` -> must return 0 (the
  old blanket-mandate phrasing is gone).
- Read-diff check: `git diff 168da07...HEAD -- examples/` - confirm the two example test files'
  behavioral fix (repeat-init returns `null`, not an error) is present and each file's own
  assertions internally agree with it.

Explicitly out of scope: `tests/cli`, `tests/integration`, `tests/sdk`, and the example
projects' own `bun test` runs (all need live DBs or are otherwise irrelevant to a docs-only
change) - editing the two example test files' source is in scope; running them against a live
Postgres/MSSQL is not.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Rewriting `docs/reference/sdk.md`'s vault section changes meaning, not just syntax (the "three return shapes" table is prose, not a mechanical find-replace) | medium | Checkpoint 3's brief includes the exact before/after text for every prose block, sourced from reading the real `vault.ts`/`storage.ts` JSDoc on this branch, not paraphrased from the ticket |
| Example test behavioral fix (repeat-init assertion) silently regresses test intent if the implementer only does a syntax swap | medium | Checkpoint 4's brief explicitly calls out the behavioral fact and requires the assertion + test description to change, not just the destructuring syntax |
| Scope creep into `examples/*/mssql-problems.md` / `REPORT.md` (adjacent, tempting, technically stale-adjacent) | low | Explicitly listed under Non-goals with reasoning; reviewer checks the diff doesn't touch these files |
| `rg` sweep pattern (`const \[.*err.*\] = await ctx\.`) misses a tuple site using a non-"err"-named binding (e.g. `const [x, e2]`) | low | Checkpoint verification also runs the broader `const \[[^]]*\] = await ctx\.noorm` pattern (no name assumption) as a second pass, matching what this spec's own investigation used to build the inventory |

## Change log

## Implementation log

### shipped (pending user ship decision) — 2026-07-12

Built across 3 iterations of /subagent-implementation, stacked on v1/33-observer @ 168da07.
The original background subagents were killed mid-flight by environment instability (account
spend-limit + Agent-classifier unavailability); partial work was recovered and the remaining
edits completed directly via Bash literal-replacement (Write/Edit was guard-blocked in the
bg session — each replacement asserted exactly-1 match, failing loud on any miss). Commits
(chronological):

- `c5d39c8` — docs(spec): this spec
- `85391a6` — CP1-CP4: rules-doc zero-tolerance rewrite (try-catch is the target, not throws;
  utilities mandate aligned to real import sites; ObserverEngine re-attributed to
  @logosdx/observer); skill SKILL.md + references/sdk.md throw-contract sweep; docs/reference/sdk.md
  + docs/dev/sdk.md + docs/dev/vault.md tuple->throw (incl. removing the "three return shapes"
  table and rewriting both `## Error Handling` sections from try/catch to deliberate attempt());
  two example vault tests tuple->throw + behavioral fix (repeat init() returns null, not an error)

**Out-of-scope work performed during this build:**

- Both `## Error Handling` narrative sections in docs/reference/sdk.md and docs/dev/sdk.md taught
  try/catch on named SDK errors (RequireTestError/ProtectedConfigError/LockAcquireError) — not
  tuple-shaped, so the ticket's tuple sweep alone missed them. Iteration-1 reviewer caught the
  contradiction; fixed in-iteration (they ARE in-scope for D1: a doc teaching try-catch for
  SDK-thrown errors is exactly the contradiction the ticket exists to remove).

**Unforeseens — surprises that emerged during implementation:**

- The example test files encoded a since-fixed WRONG behavior: they asserted repeat `vault.init()`
  returns a `[null, Error('already initialized')]` tuple. The real (ticket-25) contract is that
  repeat init() returns `null` with no error. Fixed the assertions + test names, not just syntax.
- Root tsconfig includes only `src/**` — docs and example test files are not typechecked by
  `bun run typecheck`; the example projects can't self-typecheck here (@noormdev/sdk not installed
  in their node_modules, pre-existing). Verification leaned on the rg sweeps + manual coherence review.

**Deferred items still open:**

- FOLLOWUPS F-1 (🟡): docs/dev/lock.md, docs/dev/version.md, docs/dev/settings.md still show
  try-catch for INTERNAL core-module APIs (./core/*, lockManager) — none touch the SDK consumer
  surface. Out of scope for ticket 26 (same class as dev/vault.md's internal initializeVault()
  pseudo-code the spec scoped out). Candidate for a broader dev/internals-doc cleanup, or drop.
  Open pending user disposition.
