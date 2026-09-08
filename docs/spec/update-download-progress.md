# Update download progress (TUI)


## Goal


Show live download progress on the TUI's update screen. `src/core/update/updater.ts` already emits `update:progress` (`{version, received, total}`) every 512KB and `update:retry` on a resumed attempt, and the CLI (`src/cli/update.ts`) already renders both. The TUI ignores them: `UpdateScreen` shows a bare `Spinner label="Installing <version>..."` for the whole of a ~70MB download, so the screen looks identical to a hang.

Consume the events that are already flowing. No change to `core/update`.


## Non-goals


- Any change to the download, retry, resume, checksum, or swap mechanism in `src/core/update/updater.ts`. It is already correct.
- Changing the CLI's rendering (already done), beyond one comment/behaviour mismatch noted below.
- Progress for the npm install path, since `npm install -g` owns its own output and emits no byte counts.
- A new event; `update:progress` already carries everything needed.


## Success criteria


- [ ] A `useUpdateProgress` hook exists in `src/tui/hooks/`, subscribes via `useOnEvent` to `update:progress` and `update:retry`, and exposes `{ state, reset }` following the shape of the sibling `useTransferProgress`.
- [ ] It is a **separate hook**, not an extension of `useUpdateChecker`: `useOnEvent` requires the `NoormObserver` provider, and `tests/cli/hooks/useUpdateChecker.test.tsx` renders that hook without one, so folding the subscription in would break it.
- [ ] Exported from the `src/tui/hooks/index.ts` barrel alongside its state type.
- [ ] `UpdateScreen`'s installing state renders received/total MB, a floored integer percent, and an `@inkjs/ui` `ProgressBar` when the total is known; falls back to MB-only with the spinner when it is not.
- [ ] A retry shows the attempt (`n/max`) and its reason, so a resumed download does not read as a stall.
- [ ] Progress state resets when a new install starts, so a second attempt in one session does not begin at the previous run's percentage.
- [ ] Hook tests live in `tests/cli/hooks/useUpdateProgress.test.tsx`, wrap in `NoormObserver`, and drive real `observer.emit(...)` calls, following the `useTransferProgress.test.tsx` pattern rather than module mocks.
- [ ] `src/cli/update.ts`'s non-TTY comment matches its behaviour: it claims a "fall back to periodic newlines" that the code does not implement (`onProgress` writes nothing when `!isTty`).
- [ ] `bun run typecheck`, `bun run lint`, and the CLI test group pass.


## Approaches


| # | Approach | Sketch | Cost | Risk |
|---|----------|--------|------|------|
| A | Separate `useUpdateProgress` hook + `ProgressBar` in the screen (chosen) | Mirrors `useTransferProgress`/`useRunProgress`; screen composes both hooks | low | none material |
| B | Fold progress state into `useUpdateChecker` | One hook owns check + install + progress | low | breaks `useUpdateChecker.test.tsx` (no provider); merges two lifecycles into one hook |
| C | Subscribe in `UpdateScreen` directly | `useOnEvent` inline in the component | trivial | state and reset logic in a render path; no unit seam; diverges from three sibling progress hooks |


## Recommendation


**A.** The repo already answers this question three times. `useRunProgress`, `useTransferProgress`, `useChangeProgress` are each a hook that turns an observer event stream into screen state. Update progress is the same shape, so it gets the same shape. **B** is the smaller diff on paper but breaks an existing test for a structural reason (the provider), and **C** puts reducer logic where it cannot be tested without rendering the whole screen.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | `useUpdateProgress` hook + barrel export + hook tests driving real `observer.emit` under `NoormObserver` | new `src/tui/hooks/useUpdateProgress.ts`, `src/tui/hooks/index.ts`, new `tests/cli/hooks/useUpdateProgress.test.tsx` | atomic-implementer (surgical) | ~3 | `bun test --serial tests/cli/hooks/useUpdateProgress.test.tsx`; `bun run typecheck` |
| 2 | Render it: `UpdateScreen` installing state gains MB / percent / `ProgressBar` / retry notice, and resets on install start | `src/tui/screens/UpdateScreen.tsx` | atomic-implementer (surgical) | 1 | `bun run typecheck`; `bun run lint`; screen renders progress rather than a bare spinner |
| 3 | Correct the CLI's non-TTY comment to match behaviour | `src/cli/update.ts` | atomic-implementer (surgical) | 1 | comment and code agree |
| 4 | Document the TUI progress display | `docs/tui.md` | atomic-implementer (surgical) | 1 | update screen section describes what the user sees |
