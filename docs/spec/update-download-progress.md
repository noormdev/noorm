# Update download progress (TUI)


## Goal


Show live download progress on the TUI's update screen. `src/core/update/updater.ts` already emits `update:progress` (`{version, received, total}`) every 512KB and `update:retry` on a resumed attempt, and `src/cli/update.ts` already renders both. The TUI ignores them: `UpdateScreen` shows a bare `Spinner` for the whole of a ~70MB download, so the screen looks identical to a hang.

Consume the events that are already flowing. No change to `core/update`.


## Non-goals


- Any change to the download, retry, resume, checksum, or swap mechanism in `src/core/update/updater.ts`. It is already correct.
- Changing how the CLI renders progress. That is already shipped, beyond one comment that describes a fallback the code does not implement.
- Progress for the npm install path, since `npm install -g` owns its own output and emits no byte counts.
- A new event. `update:progress` already carries everything needed.


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


## Approach


**A**, a separate `useUpdateProgress` hook consumed by the screen. See [the design doc](../design/update-download-progress.md).


## Change tree


```
src/tui/hooks/
├── useUpdateProgress.ts .................... A  (useUpdateProgress; UpdateProgressState/UpdatePhase/UpdateRetryInfo)
└── index.ts ................................ M  (barrel export)
src/tui/screens/
└── UpdateScreen.tsx ........................ M  (installing branch: MB, percent, ProgressBar, retry line, reset on install)
src/cli/
└── update.ts ............................... M  (non-TTY comment corrected to match behaviour; early return)
tests/cli/hooks/
└── useUpdateProgress.test.tsx .............. A  (real observer.emit under NoormObserver, no module mocks)
docs/
├── tui.md .................................. M  (### Update entry in the screen reference)
├── design/update-download-progress.md ...... A  (approaches, recommendation)
└── spec/update-download-progress.md ........ A  (this file)
```


## Outline


```
src/tui/hooks/useUpdateProgress.ts
  UpdatePhase — 'idle' | 'downloading' | 'complete'
  UpdateRetryInfo — attempt (0-based, as the event carries it), maxAttempts, error
  UpdateProgressState — phase, received, total, retry
  useUpdateProgress — subscribes the four update events, returns { state, reset }
    update:installing — phase to downloading and counters cleared, so a second install in one session does not start at the prior run's numbers
    update:progress — received/total
    update:retry — records the retry without zeroing received, since the download resumes from bytes already on disk
    update:complete — phase to complete
    reset — back to INITIAL_STATE, for the caller to clear at keypress time

src/tui/hooks/index.ts
  useUpdateProgress export — hook plus UpdateProgressState, UpdatePhase, UpdateRetryInfo

src/tui/screens/UpdateScreen.tsx
  installing branch — MB to one decimal, floored percent, ProgressBar gated on total > 0, MB-only fallback when total is 0, retry line rendering attempt + 1
  handleInstall — resetProgress() before performUpdate()

src/cli/update.ts
  onProgress — early return off-TTY rather than formatting a line to discard; comment states suppression rather than a newline fallback that never existed

tests/cli/hooks/useUpdateProgress.test.tsx
  progress updates received/total
  a fresh update:installing resets counters from a prior run
  a retry is recorded without zeroing received
  complete sets the phase

docs/tui.md
  ### Update — screen reference entry: keys, the progress display, the unknown-size fallback, the resume notice
```


## Flows


**Watching a binary update download**

1. User presses `u` from Home, then `i` to install.
2. `handleInstall` calls `resetProgress()`, clearing any prior run's numbers before anything is emitted.
3. `installUpdate` emits `update:installing` synchronously, before its first `await`; the hook moves phase to `downloading` and clears counters again, which keeps the hook correct for any consumer that did not call `reset` itself.
4. The download loop emits `update:progress` every 512KB. The screen renders `received / total MB (percent%)` and a `ProgressBar`.
5. On the final chunk the updater emits once more, so the display lands on the true total rather than the last 512KB boundary.
6. `update:complete` moves phase to `complete`; the screen's own `done` state takes over from `performUpdate`'s resolved result.

**A stalled download resuming**

1. No bytes arrive for 30s, so the updater aborts that attempt and emits `update:retry` with the reason and the attempt number.
2. The hook records the retry and leaves `received` alone.
3. The screen shows the reason and `attempt + 1` of `maxAttempts` in yellow, so the pause reads as a resume rather than a hang.
4. The retried request resumes from the bytes already on disk via an HTTP range request, so progress continues from where it stopped rather than restarting at zero.

**A server that sends no Content-Length**

1. `update:progress` arrives with `total` of 0.
2. The screen renders received megabytes alone, with no percent and no `ProgressBar`, rather than a bar stuck at 0% or NaN%.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | `useUpdateProgress` hook + barrel export + hook tests driving real `observer.emit` under `NoormObserver` | `src/tui/hooks/useUpdateProgress.ts`, `src/tui/hooks/index.ts`, `tests/cli/hooks/useUpdateProgress.test.tsx` | atomic-implementer (surgical) | ~3 | `bun test --serial tests/cli/hooks`; `bun run typecheck` |
| 2 | Render it: `UpdateScreen` installing state gains MB / percent / `ProgressBar` / retry notice, and resets on install start | `src/tui/screens/UpdateScreen.tsx` | atomic-implementer (surgical) | 1 | `bun run typecheck`; `bun run lint`; screen renders progress rather than a bare spinner |
| 3 | Correct the CLI's non-TTY comment to match behaviour | `src/cli/update.ts` | atomic-implementer (surgical) | 1 | comment and code agree |
| 4 | Document the TUI progress display | `docs/tui.md` | atomic-implementer (surgical) | 1 | update screen section describes what the user sees |


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| The installing branch cannot be reached in a test without `mock.module`, whose registry is process-global in Bun and never restores, so a screen test would poison every later file in its CI group | high | Keep all state transitions in the hook, where real `observer.emit` calls test them with no mocks; verify the JSX by rendering the screen out-of-process, where pollution cannot reach the suite |
| A second install in one session starts at the previous run's percentage | med | Reset on `update:installing` inside the hook, and call `reset()` from `handleInstall` before `performUpdate()`; covered by a hook test |
| A retry zeroes displayed progress, making a resume look like a restart | med | The retry handler leaves `received` untouched, matching the range-request resume the updater actually performs; covered by a hook test |
| A `ProgressBar` renders at 0% or NaN% when the server sends no `Content-Length` | med | Gate both the percent and the bar on `total > 0`, falling back to bare megabytes |
| The TUI and CLI drift into different vocabulary for the same event | low | The retry line mirrors `src/cli/update.ts`'s wording verbatim, including its `attempt + 1` conversion |


## Change log


### 2026-09-08 — spec brought up to repo standard

**What changed:** Added the `## Change tree`, `## Outline`, `## Flows`, `## Risks` and `## Change log` sections the standing spec-currency rule requires. The `## Approaches` table and `## Recommendation` argument moved to `docs/design/update-download-progress.md`, leaving a one-line `## Approach` pointer in their place.

**Why:** Audit finding. `docs/spec/sdk-with-schema.md`, authored a few commits earlier in this repo, carries all five sections and the pointer form, so the convention was in force when this spec was drafted and this spec simply did not follow it.
