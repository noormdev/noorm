# Spec: v1-36 ConfigEditScreen hooks-order fix

- Ticket: `tickets/v1/36-configedit-hooks-order.md`
- Finding: F-1, discovered by ticket 29 (recorded on `v1/29-locked-stage-guard`
  `STATE.md` and the spec's implementation log — confirmed present at base
  `1f718c5`, NOT introduced by 29)
- **Stacked branch:** base is `v1/29-locked-stage-guard` (HEAD `d0ed966`), not
  `master`. Ticket 29 added the stage-lock blocked panel to `ConfigEditScreen.tsx`
  and is where this bug was surfaced. Stacking avoids a merge conflict and
  builds on 29's changes to the same file. This diff is reviewed as the delta
  on top of `d0ed966`, not against `master`.

## Goal

`ConfigEditScreen.tsx` calls `useStdout()` (line 256) after two conditional
early returns (`if (!configName) return <MissingParamPanel .../>` at line 243,
`if (!config) return <NotFoundPanel .../>` at line 250) — a Rules of Hooks
violation. React requires every hook to run in the same order on every render
of a mounted component instance. Here, hook count differs between renders of
the *same* instance depending on whether `config` has resolved yet: an initial
render before `stateManager`/`config` finish loading takes the `!config` early
return (11 hooks called, `useStdout` skipped); once loading completes and a
re-render reaches the bottom of the function, `useStdout` fires as a 12th hook.

This reproduces today. Baseline run of the existing test
(`tests/cli/screens/config/ConfigEditScreen.test.tsx`, base SHA `d0ed966`)
prints:

```
React has detected a change in the order of Hooks called by ConfigEditScreen.
...
11. useCallback               useCallback
12. undefined                 useContext
```

(`useStdout` is `useContext(StdoutContext)` internally — hence `useContext` on
the "next render" column.) A hook that fires conditionally can read stale or
undefined values, or crash outright on a future React version that enforces
hook-order invariants harder than a dev warning.

## Fix

Hoist `useStdout()` above both early-return guards, alongside the component's
other unconditional hooks (`useState`/`useMemo`/`useCallback` calls at the top
of the function body). All hooks then run unconditionally, in the same order,
on every render — before either `return`.

Audit performed across `src/tui/screens/**/*.tsx` for the same pattern (hook
call positioned after an early return): confirmed `ConfigEditScreen.tsx` is
the only offender.

- `SqlTerminalScreen.tsx` also calls `useStdout()`, but at line 49 — before
  any state, effects, or returns. Not affected.
- The five other screens using `MissingParamPanel`/`NotFoundPanel` early
  returns (`ChangeRemoveScreen`, `ChangeRevertScreen`, `ConfigCopyScreen`,
  `ConfigRemoveScreen`, `ChangeEditScreen`, `ChangeRunScreen`) all call their
  hooks (`useAsyncEffect`, `useInput`) before their early-return guards. Clean.

No sibling-screen follow-up needed — the audit found no other occurrence.

## Contract

- Every hook in `ConfigEditScreen` (`useRouter`, `useAppContext`, `useToast`,
  `useState` x3, `useMemo` x3, `useCallback` x2, `useStdout`) runs
  unconditionally before either early-return `if` statement — same hook count,
  same order, on every render regardless of which branch (`missing name` /
  `not found` / `normal form`) is taken.
- The "hooks order changed" React warning no longer appears when running
  `tests/cli/screens/config/ConfigEditScreen.test.tsx` (which exercises the
  async-load path where `config` starts unresolved and resolves on a later
  render — the exact condition that triggers the warning today).
- Zero behavior change to the edit flow: form rendering, submit, cancel,
  rename-path delete (ticket 29's `SettingsProvider` wiring), and the
  terminal-height calculation (`stdout.rows` -> `formHeight`) all behave
  identically. Only hook *position* moves — no logic changes.

## Checkpoint

| # | Scope | Done when |
|---|-------|-----------|
| 1 | `src/tui/screens/config/ConfigEditScreen.tsx`: move `const { stdout } = useStdout();` above the `if (!configName)` guard, next to the component's other unconditional hooks. `tests/cli/screens/config/ConfigEditScreen.test.tsx`: add/extend a test asserting no "hooks order changed" console warning fires across the async-load -> resolved-render transition. | Failing test first (reproduces the warning on current code), then the hoist. `bun test --serial tests/cli/screens/config/ConfigEditScreen.test.tsx` green with no hooks-order warning in output. `bun run typecheck` and `bun run lint` clean. Existing test (`should pass a SettingsProvider...`) still passes unmodified in behavior. |

## Acceptance criteria (verbatim from ticket 36)

- All hooks in ConfigEditScreen run before any early return; the "hooks order
  changed" warning no longer appears in its tests.
- A quick audit confirms no sibling screen repeats the pattern (or tickets any
  that do).

## Out of scope

- No behavior change to the edit flow (per ticket's scope boundary).
- Other TUI screens — audit found none with the same pattern; no follow-up
  ticket needed.
- Ticket 11 (also stacked on 29) touches `state/manager.ts` + validators, not
  `ConfigEditScreen.tsx` — no overlap with this diff.

## Change log

- 2026-07-12 — initial spec, stacked on `v1/29-locked-stage-guard`.
