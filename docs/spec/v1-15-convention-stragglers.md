# Spec: v1-15 Convention stragglers — last try-catch + TS `private` → `#private`

Ticket: `tickets/v1/15-convention-stragglers.md` (realm repo). Branch: `v1/15-convention-stragglers` off `next` @ `bce82df`. Reviewers diff against `bce82df`.

## Goal

Two mechanical convention conversions, zero behavior change:

1. Convert the **single remaining try-catch block in all of `src/`** — `src/tui/screens/db/DbTransferScreen.tsx:629-654` — to `attempt()`. (The ticket's original count of 11 blocks across 9 TUI files is stale: tickets 10/11/12 already converted the rest on `next`. Verified by AST census: every other `try {` occurrence in `src/` is inside a comment or string.)
2. Convert TS `private` members to native `#private` in the two managers the audit flagged:
   - `src/core/state/manager.ts` — fields `state`, `privateKey`, `statePath`, `loaded` (lines 81-84); constructor **parameter property** `private readonly projectRoot` (line 87 — needs an explicit `#projectRoot` field declaration + constructor assignment); private methods `persist()` (282) and `getState()` (327).
   - `src/core/lock/manager.ts` — private methods `getLock` (409), `createLock` (442), `extendLock` (477), `cleanupExpired` (518).

## Non-goals

- Any semantic change to error handling. The DbTransferScreen catch body (isCancelled check → setError/setPhase/setLoadingSchemas → return) must behave identically as an `if (err)` branch after `attempt()`.
- Converting `private` anywhere else in `src/` — only the two flagged managers.
- Touching `.claude/rules/typescript.md` (ticket 24 owns rule-file edits).

## Constraints

- Before converting a `private` member, grep `src/` and `tests/` for any access from outside the class — including test-only escapes like `(manager as any).state`. Native `#` fields are hard-private at runtime; any such access must be reworked (in the test) or surfaced as a blocker, not silently broken.
- `attempt` is NOT currently imported in `DbTransferScreen.tsx` (verified: zero matches for `attempt` in the file). Add `import { attempt } from '@logosdx/utils';` to the existing import block (other `src/core/**` files use this exact import path).
- Follow `.claude/rules/typescript.md` (4-block structure, blank-line style) for touched code.

## Checkpoints

| # | Checkpoint | Files | Agent | Verifies |
|---|---|---|---|---|
| 1 | try-catch → attempt | `src/tui/screens/db/DbTransferScreen.tsx` | atomic-implementer (mode: surgical) | Block at 629-654 becomes `const [, err] = await attempt(...)`-style with identical branch behavior; `sg run -p 'try { $$$ } catch ($E) { $$$ }'` over `src/` (ts + tsx) returns 0 real matches; scoped tests `tests/tui/**/*transfer*` (or the file's existing suite) green. |
| 2 | `#private` conversion, both managers | `src/core/state/manager.ts`, `src/core/lock/manager.ts` | atomic-implementer (mode: surgical) | No `private ` keyword remains in either file; parameter property handled with explicit field; outside-class access census clean; `tests/core/state/**` and `tests/core/lock/**` green; `bun run typecheck` green. |

## Acceptance criteria (from ticket)

- AST scan for try-catch over `src/` returns 0.
- No TS `private` keyword remains in the two managers; tests green.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tests reach into privates via `as any` | medium | Census first (checkpoint constraint); rework the test access, or stop and record a blocker in STATE.md if the access is load-bearing. |
| Ink/React re-render subtleties around the converted async block | low | The conversion keeps identical statement order and state-setter calls; scoped TUI tests confirm. |

## Change log

- 2026-07-12 — initial spec, authored by orchestrator pre-implementation. Ticket's stale 11-block count corrected to 1 after AST census on `next`.
- 2026-07-12 — corrected constraint: `attempt` is not pre-imported in `DbTransferScreen.tsx` (grep returned zero matches); implementer must add the import from `@logosdx/utils`. Also ran outside-class access census for checkpoint 2's flagged privates (state/manager.ts, lock/manager.ts) across src/ and tests/ — clean, no `as any` escapes or external direct calls found.
