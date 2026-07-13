# Spec: v1-43 SDK `run.build` must honor `build.include`/`exclude`/rules

Ticket: `tickets/v1/43-sdk-build-ignores-include.md` (realm repo). Found during live UAT 2026-07-13. Branch: `v1/43-sdk-build-include` off `next` @ `ad7b2ec`. Reviewers diff against `ad7b2ec`. **v1-blocker.**

## Goal

`src/sdk/namespaces/run.ts` `build()` (line ~162) calls `runBuild(context, sqlPath, { force })` without consulting `settings.build.include`/`exclude` or `settings.rules`. Headless `noorm run build` (CLI/MCP/SDK, plus `db.reset` via `src/sdk/noorm-ops.ts:114`) therefore executes every discovered file, while the TUI's `RunBuildScreen` applies `getEffectiveBuildPaths` (`src/core/settings/rules.js`) + `filterFilesByPaths` (`src/core/shared`) with base = the resolved sql dir. Same operation, two behaviors; in CI the include/exclude contract is silently void.

Fix in `build()`, mirroring `RunBuildScreen.tsx`'s loading effect exactly:

1. Compute `effectivePaths = getEffectiveBuildPaths(settings.build?.include ?? [], settings.build?.exclude ?? [], settings.rules ?? [], configForMatch)` where `configForMatch` carries `{ name, access, isTest, type }` from the SDK state's active config (find the equivalent fields on `this.#state` — the TUI builds it from `activeConfigName`/`activeConfig`; the reviewer must verify field parity).
2. `discoverFiles(sqlPath)`, then `filterFilesByPaths(files, sqlPath, effectivePaths.include, effectivePaths.exclude)` — base is the **sql dir**, patterns are sql-dir-relative per `docs/guide/sql-files/organization.md:133-140`.
3. Pass the filtered list through `runBuild`'s existing `preFilteredFiles` 4th parameter (`src/core/runner/runner.ts:108-123`). When include/exclude/rules are all empty, preserve current behavior exactly (all files; simplest: pass the unfiltered discovery result, or undefined — implementer's choice, but document which and why in the diff).

Also fix the `filterFilesByPaths` JSDoc example (`src/core/shared/files.ts:~20-45`): it shows `baseDir = '/project'` with `sql/`-prefixed patterns, contradicting the documented sql-dir-relative contract and the two real call sites. Rewrite the example with base = the sql dir and unprefixed patterns (`01_tables`, …).

## Non-goals

- Changing rules semantics (`getEffectiveBuildPaths` internals untouched).
- TUI changes — `RunBuildScreen` already behaves correctly.
- A zero-match warning when filtering yields 0 files (separate followup; file it in FOLLOWUPS.md).
- `run.file`/`run.dir` namespaces — build-scoped settings only apply to build.

## Checkpoints

| # | Checkpoint | Files | Agent | Verifies |
|---|---|---|---|---|
| 1 | SDK build filtering | `src/sdk/namespaces/run.ts`, SDK run tests | atomic-implementer (mode: feature) | New/extended unit test (sqlite or temp-dir fixture, no live DB): settings with `include: ['a']` and files under `a/` + `b/` → build executes only `a/` files; with empty build settings → all files (regression guard); rules matching `isTest` alter the effective set. `db.reset` path inherits (assert via its delegation, not duplicate machinery). |
| 2 | JSDoc correction + call-site audit | `src/core/shared/files.ts` | atomic-implementer (mode: surgical) | Example shows sql-dir base + unprefixed patterns; audit every `getEffectiveBuildPaths`/`filterFilesByPaths` caller (`grep -rln` both) for base consistency, record findings in STATE.md — fix only if a caller uses a wrong base (TUI `RunBuildScreen` is the reference); anything debatable goes to FOLLOWUPS.md, not the diff. |

## Acceptance criteria (from ticket)

- `ctx.noorm.run.build()` respects include/exclude/rules identically to the TUI Run Build screen; test proves an excluded dir does not run headlessly.
- `db.reset`'s rebuild inherits the filtering.
- `filterFilesByPaths` JSDoc example matches the documented contract.
- Call-site base audit recorded.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| SDK state lacks a field the TUI's `configForMatch` has (e.g. `type`) | medium | Reviewer verifies field parity against `RunBuildScreen.tsx:76-81`; if a field genuinely doesn't exist at the SDK boundary, record the delta and its match-rule impact in STATE.md — do not invent values. |
| Behavior change surprises SDK users relying on unfiltered build | accepted | That is the ticket: the documented contract (docs/guide) says include/exclude control the build; the SDK deviation is the bug. Note in CHANGELOG-worthy commit body. |
| `preFilteredFiles=[]` (legitimate all-excluded case) treated as "not provided" | medium | Check `runBuild`'s falsy handling (`if (preFilteredFiles)` at runner.ts:123 — an empty array IS falsy-adjacent: `[]` is truthy in JS, so `[]` takes the pre-filtered branch and runs nothing — verify a test covers the all-excluded → zero-files-run case rather than falling back to full discovery). |

## Change log

- 2026-07-13 — initial spec, authored by orchestrator pre-implementation.

## Implementation log

### shipped — 2026-07-13

Built across 3 iterations of /subagent-implementation. Commits (chronological):

- `f8186ce` — spec authored pre-implementation
- `e31305d` — CP-1 SDK run.build honors include/exclude/rules (filtering pipeline + preFilteredFiles 4th arg; 6 unit tests, no mock.module, DummyDriver seam)
- `af47089` — CP-2 filterFilesByPaths JSDoc example corrected to sql-dir base + unprefixed patterns

**Out-of-scope work performed during this build:**

- none (an unrequested `#createRunContext()` reordering in iter 1 was reverted in iter 2 per reviewer finding)

**Unforeseens — surprises that emerged during implementation:**

- Kysely `withSchema('noorm')` clones the executor, so executor-level test spies miss schema-scoped queries; test seam moved to `driver.acquireConnection()`
- module-scope `mock.module` violates the repo's db-namespace.test.ts precedent (shared module cache in one-process CI group); tests reworked to real runBuild + DummyDriver + real state manager on temp projectRoot

**Deferred items still open:**

- F-1 (scratchpad FOLLOWUPS.md): zero-match warning when filtering yields 0 files — spec non-goal, needs product decision on surface; awaiting user triage

**Call-site audit (acceptance criterion):** recorded in STATE.md iter 3 — only two production `filterFilesByPaths` callers (TUI RunBuildScreen.tsx:106, SDK run.ts:200), both base = resolved sql dir; no wrong-base caller found.
