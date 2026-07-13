# 22 — Trim unused generic surfaces

- severity: post-v1 | effort: S
- findings: AP-yagni-03, AP-yagni-05 (research/v1-audit/atomic-principles/yagni.md)
- ticket: tickets/v1/22-trim-generic-surfaces.md
- type: deletion-only, no behavior change

## Goal

Delete generic surfaces on `WorkerBridge`/`WorkerPool` and the TUI hooks module that
carry zero production callers, per the yagni audit. Runtime behavior of every
surface DT actually uses must be unchanged.

## Out of scope

- `RpcSession.hasConnection`/`listConnections` (`src/rpc/`) — D9 ruled "implement";
  ticket 32 gives them their production caller. Do not touch `src/rpc/`.
- Any `worker-bridge` member DT still calls (`request()`, `WorkerBridge.pool()`,
  `shutdown()`, `WorkerPool.request()`/`.size`/`.isShutdown`/`.shutdown()`,
  `resolveWorker()`, `OrderBuffer`) — untouched.

## TDD

Skipped because: deletion-only, no new behavior. Safety net is the existing
worker-bridge + tui-hook test suites, which must stay green after each deletion
(minus the test blocks that exercised only the deleted surface, which are removed
alongside their subject).

## Checkpoint CP-1 — WorkerBridge / WorkerPool generic surfaces

| Symbol | Location | Pre-deletion zero-caller proof | Post-deletion proof | Status |
|---|---|---|---|---|
| `isTransferable` + `__transfer` branch in `send()` | `src/core/worker-bridge/types.ts:19-23` (fn), `bridge.ts:6` (import), `bridge.ts:62-66` (branch), `index.ts:12` (barrel export) | `rg -n '__transfer'` → only definition (types.ts:19,21) + the one branch that reads it (bridge.ts:64). `rg -n 'isTransferable'` → only definition, its one import, its one call site, and the barrel re-export — no consumer imports it from `worker-bridge/index.ts`. No `ConnectionEvents`/`ComputeEvents` payload ever sets `__transfer`. | `rg -n '__transfer\|isTransferable\|\.transfer\(\|WorkerBridge\.workerData' src/ tests/` → exit 1, no hits | done |
| `transfer()` method | `bridge.ts:90-98` | `rg -n '\.transfer\('` → zero hits anywhere in `src/` or `tests/` | `rg -n '__transfer\|isTransferable\|\.transfer\(\|WorkerBridge\.workerData' src/ tests/` → exit 1, no hits (method deleted, no residual `.transfer(` call) | done |
| Constructor `data` param + `static get workerData()` | `bridge.ts:16` (param), `bridge.ts:23` (`new Worker(script, { workerData: data })`), `bridge.ts:109-113` (static getter), `bridge.ts:1` (`workerData` import from `worker_threads`) | `rg -n 'new WorkerBridge'` → every production call site (`src/workers/connection.ts:24`, `src/workers/compute.ts:8`, `src/core/dt/index.ts:85`, `src/core/worker-bridge/pool.ts:25`, `src/cli/dev/test-workers.ts:83,160`) passes no 2nd arg. Only `tests/core/worker-bridge/bridge.test.ts:41` passes one, in the single test (`'should forward workerData to the worker'`, lines 39-45) that exercises exactly this feature — that test is deleted alongside the code. | `rg -n 'WorkerBridge\.workerData'` → exit 1, no hits; `rg -n 'new WorkerBridge<[^>]*>\([^,)]+,' src tests` → exit 1, no hits; `bridge.test.ts` no longer has the `workerData` test (verified via `git diff`) | done |
| `WorkerPool.on()` | `pool.ts:70-90` (JSDoc + method) | `rg -n 'WorkerPool'` across `src/` + `tests/` → no call site invokes `.on(` on a pool instance; the only `.on(` mentioning WorkerPool is the method's own JSDoc example (`pool.ts:76`). `tests/core/worker-bridge/pool.test.ts` has no test for `.on()`. | `rg -n '\bon\(' src/core/worker-bridge/pool.ts` → exit 1, no hits (method + JSDoc example both removed) | done |

Everything else in `bridge.ts`/`pool.ts`/`types.ts` (constructor sans `data`, `request()`,
`send()` sans the transfer branch, `static pool()`, `shutdown()`, `WorkerPool.request()`/
`.size`/`.isShutdown`/`.shutdown()`, `WireMessage`/`ResKey`/`Correlated`/`ConnectionEvents`/
`ComputeEvents`/`PoolOptions`) is production-live (DT pipeline, connection/compute
workers) — do not touch.

## Checkpoint CP-2 — `useEventPromise` / `EventPromiseState`

| Symbol | Location | Pre-deletion zero-caller proof | Post-deletion proof | Status |
|---|---|---|---|---|
| `useEventPromise` | `src/tui/hooks/useObserver.ts:123-146` (JSDoc + fn), `src/tui/hooks/index.ts:8` (barrel export), module JSDoc example at `useObserver.ts:20-22` | `rg -n 'useEventPromise'` → only the barrel re-export, the hook's own JSDoc examples, and `tests/cli/hooks/useObserver.test.tsx` (test-only). Zero call sites in `src/tui/screens/`, `src/tui/components/`, or any other TUI consumer. | `rg -n 'useEventPromise' src/ tests/ .claude/rules/` → exit 1, no hits | done |
| `EventPromiseState<T>` | `useObserver.ts:109-121`, `src/tui/hooks/index.ts:10` (barrel export) | `rg -n 'EventPromiseState'` → only the definition and its barrel export — no consumer imports the type. | `rg -n 'EventPromiseState' src/ tests/` → exit 1, no hits | done |
| Doc example | `.claude/rules/tui-development.md` "Observer Hooks" section — import line + promise-based example (`useEventPromise` mentioned twice) | Confirmed present at time of audit (AP-yagni-05 correction) | `rg -n 'useEventPromise' .claude/rules/tui-development.md` → exit 1, no hits | done |
| Test block | `tests/cli/hooks/useObserver.test.tsx:4` (docblock mention), `:17` (import), `:393-528` (`describe('useEventPromise', ...)` block) | N/A — test exists solely to cover the deleted hook | Test block removed; remaining suite (`useOnEvent`/`useOnceEvent`/`useEmit`) verified green: `bun test --serial tests/cli/hooks/useObserver.test.tsx` → 8 pass, 0 fail | done |

`useOnEvent`, `useOnceEvent`, `useEmit`, `useOnScreenPopped` and their tests are
production-live (wired into TUI screens/components) — do not touch. The `oncePromise`
member on `useNoormObserver()`'s return value is a `@logosdx/react` library API, not
ours to delete; it simply goes unused in our code after `useEventPromise` is gone.

## Acceptance criteria

- `bun run typecheck`, `bun run lint`, `bun run build` all green.
- `tests/core/worker-bridge/*.test.ts`, `tests/workers/*.test.ts`,
  `tests/core/dt/worker-pipeline.test.ts`, `tests/cli/hooks/useObserver.test.tsx` green.
- `rg` confirms zero surviving references for every deleted symbol, including
  `.claude/rules/tui-development.md`.
- `git diff` touches only `src/core/worker-bridge/{bridge,pool,index,types}.ts`,
  `src/tui/hooks/useObserver.ts`, `src/tui/hooks/index.ts`,
  `.claude/rules/tui-development.md`, `tests/core/worker-bridge/bridge.test.ts`,
  `tests/cli/hooks/useObserver.test.tsx`, `tests/fixtures/workers/echo.ts` (F-1
  fold-in, dead `workerData` branch) — nothing in `src/rpc/`, `src/mcp/`, or
  production DT/worker call sites.

## Verification commands

```bash
bun run typecheck
bun run lint
bun run build
bun test --serial tests/core/worker-bridge/bridge.test.ts tests/core/worker-bridge/pool.test.ts tests/core/worker-bridge/order-buffer.test.ts
bun test --serial tests/workers/connection.test.ts tests/workers/compute.test.ts
bun test --serial tests/core/dt/worker-pipeline.test.ts
bun test --serial tests/cli/hooks/useObserver.test.tsx
```

## Change log


### 2026-07-12 — CP-1 and CP-2 delivered

**What changed:** CP-1 (WorkerBridge/WorkerPool generic surfaces: `isTransferable`/`__transfer`, `transfer()`, ctor `data` param + `static get workerData()`, `WorkerPool.on()`) and CP-2 (`useEventPromise`/`EventPromiseState` + the `tui-development.md` doc example) both deleted, verified zero-caller via `rg`, and landed as commits `0ac3e56` and `2e3cc21`. CP-1 folded in a same-cause dead-code removal in `tests/fixtures/workers/echo.ts` (the `if (workerData)` branch, its import, and the orphaned `'init'` `EchoEvents` member — all unreachable the moment the ctor `data` param was cut). Acceptance criteria's `git diff` file list corrected to include `src/core/worker-bridge/{index,types}.ts` and `tests/fixtures/workers/echo.ts`, which CP-1's own table already named but the summary list had omitted.

**Why:** ticket 22 (deletion-only, yagni audit findings AP-yagni-03/AP-yagni-05). Independent `atomic-reviewer` pass on the full `master..HEAD` diff returned VERDICT PASS, 0🔴 0🟡 1🔵 (the stale acceptance-criteria list, corrected above) — `RpcSession.hasConnection`/`listConnections` (ticket 32, out of scope) confirmed untouched.
