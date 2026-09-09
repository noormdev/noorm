# Update download progress (TUI)


## Problem


`src/core/update/updater.ts` already emits `update:progress` (`{version, received, total}`) every 512KB during the binary download, plus `update:retry` when a stalled attempt resumes. `src/cli/update.ts` already renders both as a carriage-return status line.

The TUI does not listen. `UpdateScreen`'s installing branch is a bare `Spinner` for the whole of a ~70MB download, so the screen is indistinguishable from a hang for as long as the download runs. The data needed to fix that is already flowing through the process; nothing subscribes to it.


## Goals / Non-goals


Goal: the TUI shows the same download progress the CLI already shows, sourced from the same events.

Non-goals:

- Any change to the download, retry, resume, checksum, or swap mechanism. That code is correct and this work does not touch it.
- A new event. `update:progress` already carries everything needed.
- Progress for the npm install path. `npm install -g` owns its own output and reports no byte counts.


## Approaches


| # | Approach | Sketch | Cost | Risk |
|---|----------|--------|------|------|
| A | Separate `useUpdateProgress` hook, consumed by the screen alongside `useUpdateChecker` | Mirrors `useRunProgress` / `useTransferProgress` / `useChangeProgress` | low | none material |
| B | Fold progress state into the existing `useUpdateChecker` | One hook owns check, install and progress | low | breaks `useUpdateChecker.test.tsx`; merges two lifecycles |
| C | Subscribe with `useOnEvent` directly inside `UpdateScreen` | No new file | trivial | reducer logic in a render path, untestable without rendering the screen |


## Recommendation


**A.** The repo has already answered this question three times: `useRunProgress`, `useTransferProgress` and `useChangeProgress` are each a hook that turns an observer event stream into screen state. Update progress has the same shape, so it takes the same shape, and a reader who knows one knows all four.

**B** looks like the smaller diff but fails for a structural reason rather than a stylistic one. `useOnEvent` requires the `NoormObserver` provider, and `tests/cli/hooks/useUpdateChecker.test.tsx` renders that hook with no provider around it. Folding the subscription in breaks an existing passing test, and the repair would be to wrap that test in a provider it never needed, which is a worse trade than adding a file.

**C** puts reducer logic somewhere it can only be exercised by rendering the whole screen. That matters more than usual here: reaching the installing branch requires `installUpdate` to be mid-flight, which cannot be arranged without `mock.module`, and Bun's mock registry is process-global and never restores, so a mock in a screen test poisons every later file in its CI group. Keeping the state transitions in a hook keeps them testable with real `observer.emit` calls and no mocks at all.


## Open questions


None. The event contract is fixed and already in production behind the CLI.
