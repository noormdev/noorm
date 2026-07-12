# v1-37 — Stabilize flaky updater timing tests

**Stacked branch.** Base is `v1/16-binary-checksums` (HEAD `1a06a3b`), not master — ticket 10 rewrote `downloadToFile`'s retry loop onto `@logosdx/utils` `retry()`, and ticket 16 added checksum verification on top of that. This ticket's diff is scoped entirely to `tests/core/update/updater.test.ts` and stacks cleanly on both. Review this diff against `1a06a3b`, not against master.


## Goal

`tests/core/update/updater.test.ts` fails intermittently in isolation (~24-44% observed across sampling runs) on two assertions that count observable events rather than checking byte content:

- "emits monotonic progress that reaches the total" — `ticks.length` sometimes comes back `1` instead of `>1`.
- "resumes from the partial via a range request after a stall" — `retries.length` sometimes comes back `2` instead of `1`.

Make both deterministic: 0 flakes across 20 consecutive isolated runs, without weakening either assertion, and without changing `downloadToFile`'s production behavior.


## Root-cause hypothesis and evidence

**Initial hypothesis (from the ticket text):** real-timer races — the `stallMs`/`backoffMs` wall-clock windows (200-300ms) race against mock-server (`Bun.serve`) timing under CPU load, causing spurious stall detection.

**What the evidence actually shows.** Reproduced both failures in isolation (10/25 and 6/25 runs respectively across separate sampling loops — consistent with the ticket's ~44% figure) and instrumented `downloadAttempt`'s stream-consumption loop directly (temporary `console.error` debug lines, reverted before any implementation work — no product diff carries this). Captured stack traces from both failure modes:

```
[resume test]  streamErr=undefined is not a function
TypeError: undefined is not a function
    at <anonymous> (native:1:11)
    at ReadableStreamAsyncIterator (native:2:153)

[progress test] same signature, same native frames
```

Both failures trace to the **same root cause**: a Bun runtime-internal race in `for await...of` iteration over a `fetch()` Response's `.body` (`ReadableStream`), specifically at the point where the async iterator protocol is invoked again after the stream has delivered its final chunk. It fires more often when a response body arrives as one large, instantly-complete chunk — the pattern both `/ok` (1.5 MB in one `Response(PAYLOAD, …)`) and the second `/resume` leg (`Response(PAYLOAD.slice(startByte), …)`, a plain `Uint8Array` body, not an incrementally-enqueued stream) produce over loopback. This is a known category of bug in Bun's `ReadableStream`/fetch-body implementation (`oven-sh/bun` issues #6289, #31159, #1190, #6860, #5039 — native `ReadableStream` consumption crashes/races, several explicitly on `for await` + `response.body`), not a defect in `downloadToFile`.

`downloadAttempt`'s error handling can't tell this apart from a real network failure: the thrown error isn't a `DownloadError`, so `downloadToFile`'s `shouldRetry: (err) => !(err instanceof DownloadError) || err.retriable` classifies it retriable, exactly like a genuine stall. That produces two different observable symptoms depending on when in the stream lifecycle it fires:

- **Progress test:** the race fires right as the sole successful attempt reaches natural EOF, throwing *before* the post-loop unconditional `update:progress` emit runs. `retry()` re-invokes the attempt; since `state.total > 0 && offset >= state.total` already holds (the file was fully written before the crash), the retried attempt short-circuits with zero further emits. Net: exactly one tick landed, not two-plus.
- **Resume test:** the race fires on the *second* (successful, resumed) attempt, after it already streamed all remaining bytes. The thrown error is retriable → `downloadToFile` emits a second, spurious `update:retry` → `retries.length` becomes `2`.

Byte-content assertions in every test are unaffected because they don't observe *how many* attempts or emits happened, only the final file — which `retry()`'s built-in resilience always eventually produces correctly. This matches the ticket's own observation ("byte/content assertions always pass; only timing-derived counts fluctuate") and explains it precisely.

**Deviation from the ticket's literal prescription.** The ticket suggests "inject a controllable clock / fake timers for the stall+retry windows." Faking `setTimeout`/`Date.now()` would not fix this — the race is not in the stall-timer wall-clock comparison, it's in Bun's native stream-consumption path, which fake timers don't touch. The fix below targets the actual trigger instead (see Determinism mechanism). This is flagged explicitly per the ticket's own instruction to state the hypothesis (and any deviation from the initial guess) before changing the test.


## Determinism mechanism (validated)

Replace the mock server's single-shot response bodies (`/ok`'s `Response(PAYLOAD, …)` and `/resume`'s second-leg `Response(PAYLOAD.slice(startByte), …)`) with a small `chunkedStream(data, chunkSize)` helper: a `ReadableStream` whose `pull()` enqueues bounded pieces (128 KiB) and yields cooperatively between them (`wait(0)` from `@logosdx/utils`, matching the repo's "no bespoke `setTimeout` wrapper when a utility exists" convention) instead of delivering the whole payload as one native-buffered blob that completes in a single tick. This is a **test-only change** — no product code is touched.

Do **not** change the `/stall` endpoint or the first (`no-Range`) leg of `/resume` — both are deliberately "enqueue once, never close" to simulate a hang, and evidence shows the race only manifests on the *natural-completion* path (a stream that reaches EOF), never on the abort path (the stalled leg's own debug capture always threw the correct `"download stalled — no data for 0.3s"` message, never the Bun TypeError).

**Validated, not just theorized.** Prototyped this exact mechanism directly (reverted before implementation — no diff left behind) and measured:

- 65 consecutive full-file isolated runs, 0 failures (25 baseline pre-change + 40 post-change, all green) — versus the unpatched baseline's 6/25 and 10/25 failure samples.
- Revert-probe A: injected a spurious extra retry behind an env-gated one-line throw in `downloadToFile`'s retry callback (simulating a real regression in resume/retry logic) — 10/10 runs failed with the patched test, reliably catching it. Reverted.
- Revert-probe B: injected a skip of the in-loop `update:progress` emit behind an env flag (simulating a real regression in progress reporting) — 10/10 runs failed with the patched test, reliably catching it. Reverted.

Both probes confirm the assertions keep their teeth after the fix — they were not weakened, and now they fail *deterministically* on a real regression instead of *sometimes* (previously indistinguishable from a flake).


## Non-goals

- No production behavior change in `src/core/update/updater.ts` or any other `src/` file. This ticket is `tests/core/update/updater.test.ts` only.
- No fake-timer/mock-clock injection into `downloadToFile` — established above as not addressing the actual root cause, and the ticket prefers test-only changes when achievable (they are).
- No change to `/stall` or `/resume`'s first (stalling) leg — those already work correctly; the race is specific to natural-completion, single-chunk bodies.
- No fetch/fs mocking of the download path itself — the test file's own header explicitly requires real streaming behavior ("no fetch/fs mocks... the regressions we care about are behavioral"); this ticket does not relax that.
- Other flaky tests outside `updater.test.ts` are out of scope (separate tickets per the ticket's scope boundary).
- Not filing/chasing the upstream Bun issue — noted here for context; out of scope for this ticket's deliverable.


## Success criteria

- [ ] `chunkedStream(data: Uint8Array, chunkSize?: number): ReadableStream<Uint8Array>` helper added to `tests/core/update/updater.test.ts`, used by `/ok` and by `/resume`'s second (206, Range-honoring) response. Uses `wait()` from `@logosdx/utils` for the cooperative yield between enqueues (repo convention — no bespoke `setTimeout` Promise wrapper).
- [ ] `/stall` and `/resume`'s first (no-Range, stalling) leg unchanged — still a single `enqueue()` that never closes.
- [ ] 20 consecutive isolated runs of `bun test tests/core/update/updater.test.ts` — 0 failures. Record the exact pass/fail tally in TESTING.md.
- [ ] Revert-probe: a deliberately injected regression (extra spurious retry, or a skipped progress emit — implementer's choice of mechanism, env-gated and reverted after, never committed) makes the two target assertions fail reliably (not just "sometimes") under the patched test, proving they still catch real bugs. Document the probe and its result in TESTING.md; do not leave probe code in the committed diff.
- [ ] No assertion in `updater.test.ts` is weakened (no loosened `toBe`→`toBeLessThanOrEqual`, no removed check, no increased timeout used as a band-aid).
- [ ] `bun run typecheck` and `bun run lint` green.
- [ ] No product file under `src/` in the diff.


## Checkpoints

| # | Checkpoint | Files/areas | Agent | Verifies |
|---|------------|-------|-------|----------|
| 1 | Add `chunkedStream` helper; wire into `/ok` and `/resume`'s 206 leg; run the 20x determinism proof + revert-probe | `tests/core/update/updater.test.ts` | atomic-implementer (mode: surgical) | 20/20 isolated runs green; revert-probe reliably reds; typecheck/lint green; no `src/` file touched |

Single checkpoint — this is a contained, single-file, test-only fix (ticket effort: S-M).


## Contract

- **Determinism:** `bun test tests/core/update/updater.test.ts` run 20 consecutive times in isolation (fresh process each run, matching how CI/local triage already runs this file) — 0 failures.
- **Assertions still bite:** revert-probe (a temporary, reverted-before-commit injected regression in either the retry path or the progress-emit path) makes the corresponding assertion fail on every run it's active, not intermittently.
- **No product diff:** `git diff v1/16-binary-checksums...HEAD -- src/` is empty.


## Change tree

```
tests/core/update/updater.test.ts ......... M  (chunkedStream helper; /ok and /resume 206-leg use it)
```


## Change log

<!-- Populated on first amendment after the spec is approved. Do not log drafting/refinement turns. -->


## Implementation log

### shipped (branch v1/37-updater-flake, stacked on v1/16-binary-checksums) — 2026-07-12

Built in 1 iteration of /subagent-implementation (single checkpoint, test-only), green-committed on PASS. Reviewer verdict PASS. Commits (chronological):

- `24ed7c5` — spec: determinism contract (stacked base, root-cause hypothesis + evidence, mechanism, revert-probe contract)
- `20a5fb5` — CP-1 `chunkedStream` helper in `updater.test.ts`; `/ok` and `/resume`'s 206 leg stream in 128 KiB chunks with a `wait(0)` cooperative yield

**Root cause (diagnosed before touching the test, per atomic-debug):** not the stall-timer wall clock the ticket suspected. A Bun runtime-internal race in `for await` iteration over a `fetch()` Response's `.body` `ReadableStream` (native frames `ReadableStreamAsyncIterator`; known upstream category — oven-sh/bun #6289, #31159, #1190, #6860, #5039), triggered when a body arrives as one instantly-complete chunk. The thrown `TypeError` isn't a `DownloadError`, so `downloadToFile`'s `shouldRetry` classifies it retriable — indistinguishable from a real stall. Fires at natural EOF of the sole/last attempt: on the progress test it pre-empts the final `update:progress` emit (→ 1 tick, not >1); on the resume test it emits a spurious second `update:retry` (→ retries.length 2, not 1). Byte assertions never saw it because `retry()` always eventually produces the correct file.

**Determinism mechanism:** serve `/ok` and `/resume`'s 206 leg via a `pull()`-based `chunkedStream` (128 KiB pieces, `wait(0)` between enqueues) so those bodies complete over multiple ticks instead of one native-buffered blob. `/stall` and `/resume`'s first (stalling) leg left as single-`enqueue()`-never-close — the race only manifests on natural completion, never the abort path. Test-only; no `src/` change.

**Deviation from ticket prescription (flagged in spec):** ticket suggested fake timers / injectable clock for the stall+retry windows. Rejected — the race is in Bun's native stream path, which fake timers don't touch. Fixed the actual trigger instead. No production seam was added (ticket allowed one "if unavoidable"; it was avoidable).

**Evidence:** baseline 6/25 and 10/25 isolated-run failures (≈ ticket's 44%) → post-fix 80/80 isolated runs green across implementer (20) + reviewer (40) + orchestrator finalize (20), 0 flakes. Revert-probe both directions: injected spurious-retry throw → 10/10 red on `retries.length`; injected progress-emit skip → 10/10 red on `ticks.length`; both fully reverted (empty `src/` diff, no probe scaffolding committed). Assertions retained full strictness — none weakened.

**Out-of-scope work performed during this build:**

- none. Single-file test change plus the scratchpad TESTING.md. No product behavior change; other flaky tests left to their own tickets per the scope boundary.

**Unforeseens — surprises that emerged during implementation:**

- The ticket's stated cause (wall-clock stall-window race) was a red herring — instrumentation showed a Bun runtime stream-iteration race instead. Documented in the spec's Root-cause section so a future reader doesn't re-chase the timer theory. The fix still delivers exactly what the ticket wanted (deterministic timing-derived-count assertions), just via the correct substrate.

**Deferred items still open:**

- none blocking. F-1 (reviewer ❓ — spec Contract references TESTING.md) resolved at finalize: TESTING.md is the orchestrator-owned scratchpad doc, written with the determinism + revert-probe evidence; the committed repo diff is test-code only by design.

**Verification @ 20a5fb5 (run by orchestrator at finalize, not trusting subagents):** `bun run typecheck` exit 0; `bun run lint` exit 0; `bun test tests/core/update/updater.test.ts` × 20 isolated fresh-process runs → 20/20 green (each 6 pass / 0 fail); `git diff 1a06a3b..HEAD -- src/` empty.
