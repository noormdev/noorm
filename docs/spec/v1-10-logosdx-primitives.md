# v1-10 — Adopt the mandated @logosdx/utils primitives


## Goal

Replace four hand-rolled implementations of behavior that `@logosdx/utils` (already a dependency, already mandated by `.claude/rules/typescript.md`) ships natively — a `sleep()` duplicate, a `Promise.race`+`setTimeout` timeout dance, a hand-rolled retry-with-backoff loop, and a manual `AbortController`+`setTimeout` — with the library's `wait`, `runWithTimeout`, `retry`, and the native `AbortSignal.timeout()`. Every swap is behavior-preserving: same timeout thresholds, same retry counts/backoff, same catchable-error contract at each call site.


## Non-goals

- The wider "rules doc mandates unused utilities (`debounce`/`throttle`/`memoize`/`circuitBreaker`/`rateLimit`/`batch`)" observation from `stdlib-first.md`/`reuse-of-deps.md` coverage notes — context only, not work for this ticket.
- Any of the other reuse/stdlib findings (voca, dayjs, formatBytes, truncate, etc.) — separate tickets.
- Renaming `registry.test.ts`'s "should use AbortController for timeout" test title — it still passes unchanged post-swap (asserts `instanceof AbortSignal`, not the mechanism); a rename is optional cosmetic cleanup, not required.


## Success criteria

- [ ] `src/core/update/updater.ts`: local `sleep()` deleted; `wait()` from `@logosdx/utils` used at the retry-loop call site.
- [ ] `src/core/lock/manager.ts`: local `sleep()` deleted; `wait()` from `@logosdx/utils` used at the poll-loop call site.
- [ ] `src/core/lifecycle/manager.ts`: `#executeWithTimeout` private method deleted; `runWithTimeout` from `@logosdx/utils` used directly in `#executePhase`. Timeout still fires at the same `#getPhaseTimeout(phase)` value; a genuine timeout still rejects (now with `TimeoutError` instead of a generic `Error`); a non-timeout failure from the wrapped function still rejects (not swallowed).
- [ ] `src/core/connection/manager.ts`: `closeAll()`'s manual `Promise.race`+`setTimeout`/`clearTimeout` bookkeeping deleted; `runWithTimeout` used per tracked-connection destroy, still bounded by the existing 5000ms `CLOSE_TIMEOUT`. A destroy that hangs past 5000ms still resolves the loop (does not reject `closeAll`) — see Outline for how `throws` is set per call site.
- [ ] `src/core/update/updater.ts`: `downloadToFile`'s hand-rolled `for` loop + local `sleep`-based backoff replaced with `retry()` from `@logosdx/utils`. Exact same call count (`maxAttempts`), exact same `update:retry` emit shape and count, exact same linear-by-attempt backoff timing (`backoffMs * attemptNo`), exact same non-retriable short-circuit (no retry, no emit), exact same thrown error on exhaustion (the original last error, not a generic `RetryError`).
- [ ] `src/core/update/registry.ts`: manual `AbortController`+`setTimeout`+`clearTimeout` in `fetchPackageInfo` replaced with `AbortSignal.timeout(TIMEOUT_MS)`. Same 5000ms timeout, same graceful-null-on-abort behavior.
- [ ] All five affected test files green: `tests/core/update/updater.test.ts` (run in isolation — known combined-run flake unrelated to this change), `tests/core/update/registry.test.ts`, `tests/core/lock/manager.test.ts`, `tests/core/lifecycle/manager.test.ts`, `tests/core/connection/manager.test.ts`.
- [ ] `bun run typecheck` and `bun run lint` green.
- [ ] No new try-catch introduced (repo's zero-tolerance rule); no behavior change beyond the mandated error-type upgrades.


## Approach

Direct 1:1 replacement of each hand-rolled mechanism with its `@logosdx/utils` equivalent (or, for registry.ts, the native `AbortSignal.timeout`) at the existing call site — no restructuring beyond what's needed to fit the library's calling convention. Evidence and exact API contracts verified against the installed `@logosdx/utils@6.1.0` source (`node_modules/@logosdx/utils/dist/cjs/{async/retry.js,flow-control/with-timeout.js}`), not just its `.d.ts` files or the research docs' prescriptions — see `research/v1-audit/atomic-principles/reuse-of-deps.md` (AP-reuse-01/-02/-03) and `stdlib-first.md` (AP-std-02/-03) for the original findings. Two deviations from those docs' literal prescriptions, both required for exact behavior preservation (see Outline for why):

1. `downloadToFile`'s retry backoff is linear-by-attempt-number (`backoffMs * attemptNo`), not constant — `retry()`'s own `delay`/`backoff` options compute a constant wait per retry, so the scaled wait must live inside the `onRetry` callback with the library's own `delay` left at 0.
2. `runWithTimeout` must be called with `throws: true` at both call sites — its default (`throws` unset) silently swallows a non-timeout error from the wrapped function (returns `undefined` instead of rejecting), which would change observable behavior at both `LifecycleManager` and `ConnectionManager`.


## Change tree

```
src/core/update/updater.ts ............... M  (delete local sleep; wait() at backoff call site; downloadToFile loop -> retry())
src/core/lock/manager.ts .................. M  (delete local sleep; wait() at poll call site)
src/core/lifecycle/manager.ts ............. M  (delete #executeWithTimeout; runWithTimeout() in #executePhase)
src/core/connection/manager.ts ............ M  (closeAll(): runWithTimeout() replaces Promise.race+setTimeout)
src/core/update/registry.ts ............... M  (fetchPackageInfo: AbortSignal.timeout() replaces AbortController+setTimeout)
tests/core/lifecycle/manager.test.ts ...... M  (only if a new test is needed for the TimeoutError upgrade — see Flows)
```


## Outline

```
src/core/update/updater.ts
  sleep — DELETE (local helper at module scope)
  downloadToFile — rewrite retry loop
    per-attempt closure — recomputes offset from disk each call (retry() re-invokes the same fn); returns early (no-op) if state.total > 0 && offset >= state.total, matching the old loop's pre-attempt break
    retry(fn, opts) call — retries: maxAttempts, delay: 0, throwLastError: true,
      shouldRetry: (err) => !(err instanceof DownloadError) || err.retriable   (same predicate as today's `retriable` variable)
      onRetry: (err, attempt) => { observer.emit('update:retry', {version, attempt, maxAttempts, error: err.message}); await wait(backoffMs * attempt); }
        — onRetry's `attempt` arg is 1-indexed to "the attempt that just failed" (verified against retry.js: onRetry(lastError, attempts) fires at loop-top with attempts already incremented past the failed attempt), which is exactly the old loop's `attemptNo` — no remapping needed.
        — delay lives here (not in retry()'s own `delay` option) because retry()'s constant-per-call formula (`delay * backoff * jitter`) cannot reproduce a linearly-increasing-by-attempt wait; doing the wait inside onRetry preserves the exact backoffMs*attemptNo timing.
        — throwLastError: true makes retry() re-throw the original DownloadError/stream error on exhaustion instead of a generic RetryError — matches the old loop's `throw err`.

src/core/lock/manager.ts
  sleep — DELETE (local helper at module scope)
  acquire — poll-wait call site: `await sleep(opts.pollInterval)` -> `await wait(opts.pollInterval)`

src/core/lifecycle/manager.ts
  #executeWithTimeout — DELETE (private method; Promise/setTimeout/clearTimeout dance)
  #executePhase — call site: `attempt(() => this.#executeWithTimeout(() => this.#executePhaseResources(resources), timeout))` -> `attempt(() => runWithTimeout(() => this.#executePhaseResources(resources), { timeout, throws: true }))`
    — `throws: true` required: #executePhaseResources itself never rejects (its own per-resource attempt() swallows individual cleanup errors), so in practice this only ever times out — but throws:true is still required to not silently swallow a hypothetical future non-timeout rejection.

src/core/connection/manager.ts
  closeAll — per-tracked-connection destroy: delete manual `let timer; Promise.race([destroy().then(clearTimeout), new Promise(timer=setTimeout(...))])` -> `runWithTimeout(() => entry.conn.destroy(), { timeout: CLOSE_TIMEOUT, throws: true })`, still wrapped in the existing outer `attempt()` so a timeout or a real destroy failure both land in the existing `if (err) { observer.emit('error', ...) }` branch unchanged.

src/core/update/registry.ts
  fetchPackageInfo — delete `const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS); ... clearTimeout(timeoutId);`; pass `signal: AbortSignal.timeout(TIMEOUT_MS)` directly into the `fetch()` call. The existing `attempt(() => fetch(...))` + `if (fetchErr) return null;` already treats an abort as a graceful-null network error — no change needed there.
```


## Flows

```
Flow: downloadToFile exhausts retries on a persistent stall (tests/core/update/updater.test.ts: "gives up after exhausting the retry budget on a persistent stall")
1. attempt 1 fails (DownloadError, retriable=true via stall) -> shouldRetry true -> onRetry(err, 1) emits update:retry{attempt:1} and waits backoffMs*1
2. attempt 2 fails -> onRetry(err, 2) emits update:retry{attempt:2} and waits backoffMs*2
3. attempt 3 (== maxAttempts) fails -> shouldRetry true but retries exhausted -> retry() throws the original DownloadError (throwLastError:true) -> caller sees the same "stalled" message as before, no 3rd update:retry emitted

Flow: downloadToFile fails fast on a non-retriable error (tests/core/update/updater.test.ts: "does not retry a non-retriable 404")
1. attempt 1 fails (DownloadError 404, retriable=false) -> shouldRetry false -> retry() throws immediately, no wait, no onRetry call, no update:retry emitted

Flow: LifecycleManager phase timeout upgrades to a catchable TimeoutError
1. a shutdown phase's resources take longer than #getPhaseTimeout(phase)
2. runWithTimeout rejects with @logosdx/utils TimeoutError (message "Function timed out") instead of the old bespoke `Error("Timeout after Xms")`
3. #executePhase's attempt() catches it, marks the phase status 'timeout' (unchanged) — no existing test asserts the old message text, so no test breaks; this is the ticket's intended "catchable TimeoutError" upgrade, not a regression

Flow: ConnectionManager.closeAll bounds a hanging destroy()
1. entry.conn.destroy() takes longer than CLOSE_TIMEOUT (5000ms)
2. runWithTimeout rejects with TimeoutError instead of the old race resolving to undefined
3. outer attempt() catches it -> err is truthy -> observer.emit('error', ...) fires (previously: the race silently resolved past the timeout with no rejection, so this err branch was never reachable via timeout — only via destroy() itself throwing). This is a real, deliberate behavior improvement inherent to the swap (a hung destroy now surfaces as an error event instead of silently timing out with no signal) — flag to reviewer as an intentional, in-scope side effect of adopting a catchable TimeoutError, not scope creep. No existing test exercises a >5s hang (impractical in a unit test), so no test needs updating, but note it in the PASS report.
```


## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | `wait()` swap: updater.ts sleep + lock/manager.ts sleep | `src/core/update/updater.ts`, `src/core/lock/manager.ts` | atomic-implementer (mode: surgical) | 2 | `tests/core/lock/manager.test.ts` green; updater.ts still compiles (retry loop untouched this checkpoint) |
| 2 | `runWithTimeout` swap: lifecycle + connection manager | `src/core/lifecycle/manager.ts`, `src/core/connection/manager.ts` | atomic-implementer (mode: surgical) | 2 | `tests/core/lifecycle/manager.test.ts`, `tests/core/connection/manager.test.ts` green |
| 3 | `retry()` swap: downloadToFile | `src/core/update/updater.ts` | atomic-implementer (mode: surgical) | 1 | `tests/core/update/updater.test.ts` green **in isolation** |
| 4 | `AbortSignal.timeout()` swap: registry.ts | `src/core/update/registry.ts` | atomic-implementer (mode: surgical) | 1 | `tests/core/update/registry.test.ts` green |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `retry()`'s constant delay/backoff formula silently replaces the loop's linear-by-attempt backoff, changing observable retry timing | medium (this is the literal reading of the reuse-of-deps.md prescription) | Contract locked in Outline: scaled wait lives inside `onRetry`, `retry()`'s own `delay` stays 0. Reviewer must verify the wait call is inside `onRetry`, not passed as `delay`/`backoff` options. |
| `runWithTimeout` defaults (`throws` unset) swallow a real (non-timeout) error instead of propagating it | medium (easy to miss — the `\| null` return type signals this) | `throws: true` explicit at both call sites; contract stated in Outline and Success criteria. |
| `updater.test.ts`'s "emits monotonic progress" test is a documented pre-existing timing flake under combined runs (confirmed during spec research: passes 6/6 in isolation, fails when run alongside the other four swap-site test files in one process) | high if tests are run combined | Always run `updater.test.ts` in isolation per Checkpoint 3 and TESTING.md; do not treat a combined-run failure of this specific test as a regression from this ticket's changes. |


## Change log

<!-- Populated on first amendment after the spec is approved. Do not log drafting/refinement turns. -->
