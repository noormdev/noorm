# Spec: v1-29 locked-stage config-deletion guard

- Ticket: `tickets/v1/29-wire-locked-stage-guard.md`
- Decision: D6 (`tickets/v1/00-DECISIONS.md`) — RULED 2026-07-11: wire in
- Finding: AP-dead-04 (`research/v1-audit/atomic-principles/dead-code.md`)

## Goal

`canDeleteConfig()` (`src/core/config/resolver.ts`) and `SettingsManager.isStageLockedByName()`
(`src/core/settings/manager.ts`) are written, tested guards enforcing "locked stages prevent
config deletion" — but their only callers are their own unit tests. A config linked to a
stage the user explicitly locked deletes today with no warning, through any surface (CLI,
SDK, TUI, MCP).

Wire the existing guard into the single core deletion seam, `StateManager.deleteConfig`, so
every caller inherits it, and surface the resulting error in the two TUI screens that call
it: `ConfigRemoveScreen` (delete) and `ConfigEditScreen` (rename-away, which deletes the old
name and recreates under the new one).

## Contract

- Deleting, or renaming away (delete-then-recreate), a config linked to a **locked** stage
  fails with a clear, named error naming the locking stage. This applies uniformly through
  `StateManager.deleteConfig` — the seam every caller (CLI/SDK/TUI/MCP) goes through.
- A config linked to an **unlocked** stage, or a config with no stage settings available at
  all, deletes/renames exactly as before — zero behavior change on the unlocked path.
- The guard's existing check logic (`canDeleteConfig`) is reused as-is — same auto-link
  semantics (stage matched by config name, or explicit `stageName` override), same
  `settings` optional-dependency shape (no settings provider available → deletion proceeds,
  matching current `canDeleteConfig(configName)` behavior with no `settings` arg). This
  ticket does not change matching/lookup semantics, only wires the existing check into the
  deletion seam and improves the surfaced message to name the stage explicitly.
- Producer throws at the deletion seam (`StateManager.deleteConfig`), per the D1 SDK
  failure-contract ruling: throw a **named** error class (matching the codebase's existing
  convention — `LockAcquireError`, `ConfigValidationError`, etc. — `class X extends Error`
  with `override readonly name = 'X' as const`), not a generic `Error` and not a tuple.
  Callers that want to inspect/translate the error use `attempt()`; callers that just want
  it to fail loudly let it propagate (matches how `ConfigRemoveScreen`/`ConfigEditScreen`
  already wrap their mutation calls in `attempt()` and surface `err.message` via
  `getErrorMessage()`).

## Design

### `src/core/config/resolver.ts`

- `canDeleteConfig()`: keep the same signature and check logic. Improve the `reason` string
  to name the actual locked stage (`stageName ?? configName` — the auto-link path resolves
  the stage by looking up `configName` as the stage key, so this is always the correct
  locked-stage name, not a new lookup). Existing tests assert `reason` contains the config
  name / the substring `'locked'` — naming the stage is additive and does not break those
  assertions.
- Add `ConfigStageLockedError extends Error` (named-error convention, colocated with the
  check it enforces — same file as `canDeleteConfig`, same barrel section as
  `ConfigValidationError` is to `validateConfig`). Carries `configName` and `stageName` as
  structured fields; message reuses the stage-naming text above.
- Add `assertCanDeleteConfig(configName, settings?, stageName?): void` — throws
  `ConfigStageLockedError` when `canDeleteConfig(...).allowed` is false. Mirrors the existing
  `checkConfigPolicy` (bool check) / `assertPolicy` (throwing wrapper) pairing in
  `src/core/policy/check.ts` — same pattern, new domain.
- Export `ConfigStageLockedError` and `assertCanDeleteConfig` from `src/core/config/index.ts`
  alongside the existing `canDeleteConfig` export.

### `src/core/state/manager.ts`

- `StateManager.deleteConfig(name: string, settings?: SettingsProvider): Promise<void>` —
  add the optional `settings` parameter (same optionality as `canDeleteConfig` itself: no
  settings provider → no stages known → nothing to block, matching current behavior for
  contexts with no `settings.yml`). Call `assertCanDeleteConfig(name, settings)` as the first
  statement (validation block, per `.claude/rules/typescript.md` 4-block structure) — throws
  before any state mutation.
- Import `assertCanDeleteConfig` and the `SettingsProvider` type directly from
  `../config/resolver.js` (matches the existing `import type { Config } from
  '../config/types.js'` precedent in this file — config domain deliberately avoids importing
  from `state` to prevent a cycle: `resolver.ts`'s `StateProvider` interface exists for
  exactly this reason. The reverse direction, `state` importing from `config`, is already
  established and safe.)

### TUI: `src/tui/screens/config/ConfigRemoveScreen.tsx`

- Pull `settingsManager` from `useAppContext()` (already exposed on the context — see
  `src/tui/app-context.tsx`).
- Build a `SettingsProvider` from it (`new SettingsProvider(settingsManager)`, imported
  directly from `../../../core/config/resolver.js` — matches the existing
  `toSettingsProvider` adapter precedent in `src/sdk/index.ts`).
- Compute a lock check via the existing `canDeleteConfig(configName, settingsProvider)` and
  render it the same way the existing policy-denied check renders (`check.blockedReason` →
  red `Panel`, `[Enter/Esc] Back`) — add a sibling "denied by locked stage" branch using
  `lockCheck.reason`, before the confirmation UI. Extend the `useInput` escape/enter guard
  condition to include the new blocked state.
- Pass `settingsProvider` into `stateManager.deleteConfig(configName, settingsProvider)` in
  `handleConfirm` — belt-and-suspenders with the core-seam guard (the seam is the actual
  enforcement; the screen-level pre-check exists so the user never reaches a spinner/confirm
  step for a delete that is guaranteed to fail).

### TUI: `src/tui/screens/config/ConfigEditScreen.tsx`

- Pull `settingsManager` from `useAppContext()`, build the same `SettingsProvider`.
- Pass it into the rename-path call: `await stateManager.deleteConfig(configName,
  settingsProvider);` (line ~195). The existing `attempt()` wrapper around the whole
  save-flow already catches the thrown `ConfigStageLockedError` and surfaces
  `getErrorMessage(err)` via `setConnectionError` → `Form`'s `statusError` prop — no new UI
  branch needed; the thrown error's message already names the locking stage.

## Checkpoints

| # | Scope | Done when |
|---|-------|-----------|
| 1 | Core seam: `resolver.ts` (`ConfigStageLockedError`, `assertCanDeleteConfig`, stage-naming reason), `config/index.ts` barrel export, `state/manager.ts` (`deleteConfig` wired) | Failing test first: `StateManager.deleteConfig` on a locked-stage config throws `ConfigStageLockedError` naming the stage; unlocked-stage and no-settings cases still delete cleanly. `bun run typecheck` clean for touched files. |
| 2 | TUI: `ConfigRemoveScreen.tsx` (pre-check panel + wired call), `ConfigEditScreen.tsx` (wired rename-path call) | Screen-level test(s) proving a locked-stage config surfaces the named-stage message in each screen; the core-seam guard is confirmed load-bearing (reviewer revert-probes the wire-in — removing it must turn the seam test red). |

## Acceptance criteria (verbatim from ticket 29)

- Deleting (or renaming away) a config on a locked stage fails with a clear error naming the
  stage, via StateManager directly (covers SDK/MCP) and via the TUI screens.
- The existing guard unit tests gain an integration-level test proving the wire-in (test
  fails if the guard call is removed).
- Interaction with ticket 28's `config rm --yes` honored: `--yes` does not bypass a stage
  lock.

## Out of scope

- `config rm --yes` headless implementation itself — that is ticket 28
  (`tickets/v1/28-headless-config-parity.md`), not yet built (`config rm` is currently a
  TTY-gated stub). **Cross-ticket constraint for ticket 28:** when ticket 28 wires up
  `config rm <name> --yes`, its call into `StateManager.deleteConfig` MUST pass the
  `SettingsProvider` (same as the TUI screens do here) so `--yes` inherits the lock guard
  from the seam rather than bypassing it. `--yes` only skips the interactive confirmation
  prompt; it must never skip `assertCanDeleteConfig`. Ticket 28's own spec should reference
  this constraint explicitly.
- Rewriting or changing the guard's matching/lookup semantics (`canDeleteConfig`,
  `isStageLockedByName`) — reused as-is, per the ticket's explicit instruction not to invent
  a second rule.
- `SettingsManager.isStageLockedByName()` stays as an alternate/lower-level check already
  covered by `canDeleteConfig`'s own stage lookup; not separately wired (would duplicate the
  same enforcement path).

## Change log

- 2026-07-12 — initial spec, D6 ruling implementation.
- 2026-07-12 — implementation shipped (iterations 1-2); added implementation log.

## Implementation log

- Status: shipped — 2026-07-12 (branch `v1/29-locked-stage-guard`, not yet merged).
- Iteration 1 (`e6ce6ba`) — core seam. `ConfigStageLockedError` + `assertCanDeleteConfig`
  added to `resolver.ts`, exported via `config/index.ts`; `StateManager.deleteConfig(name,
  settings?)` calls the guard as its first statement and throws the named error naming the
  stage. Reviewer PASS; revert-probe confirmed load-bearing (removing the guard call turns
  the locked-stage seam test RED).
- Iteration 2 (`5b20462`) — TUI surfacing. `ConfigRemoveScreen` renders a stage-named blocked
  panel before confirmation; both remove and edit-rename paths pass the `SettingsProvider`
  into `deleteConfig`. Reviewer PASS; both revert-probes confirmed load-bearing.
- Verified at finalize: `bun run typecheck` (0 errors); `tests/core/state/manager.test.ts` +
  `tests/core/config/resolver.test.ts` (77 pass); `tests/cli/screens/config/` (3 pass);
  eslint clean on all 8 touched files. Build n/a (Ink tests render source).
- Named error chosen: `ConfigStageLockedError` (D1 producer-throw convention, matching
  `LockAcquireError`/`ConfigValidationError` shape). `isStageLockedByName` left in place but
  not separately wired — `canDeleteConfig`'s own stage lookup already covers the enforcement
  path; wiring both would duplicate it.
- Cross-ticket constraint recorded for ticket 28 (see Out of scope): the headless deletion
  path must pass the `SettingsProvider` into `deleteConfig` so `--yes` inherits the lock
  guard; `--yes` skips the confirm prompt, never the guard.
- Open follow-up (pre-existing, NOT introduced here): `ConfigEditScreen.tsx` calls
  `useStdout()` after two conditional early returns, violating Rules of Hooks ("hooks order
  changed" warning under the new async-load test). Confirmed present at base `e6ce6ba`. Fix
  in a dedicated ticket — move `useStdout()` above the `if (!configName)`/`if (!config)`
  guards.
