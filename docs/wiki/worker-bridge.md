---
type: Domain
description: Hub-and-spoke worker thread infrastructure — WorkerBridge/WorkerPool message routing plus the connection and compute worker entry points
---

# worker-bridge

## What it does

[`src/core/worker-bridge/`](../../src/core/worker-bridge) implements `WorkerBridge`, an `ObserverRelay<TEvents, Record<string, never>>` subclass (from `@logosdx/observer`) that wraps a `Worker` (parent side) or `parentPort` (worker side) and exposes a typed `request()`/`emit()` protocol over `worker_threads.postMessage`.

`WorkerPool` holds N `WorkerBridge` instances and dispatches `request()` calls round-robin across them.

[`src/workers/`](../../src/workers) holds the two worker thread entry points that run inside spawned threads: `connection.ts` (persistent, owns one Kysely instance) and `compute.ts` (stateless serialize/deserialize).

## Artifacts

- [`src/core/worker-bridge/bridge.ts`](../../src/core/worker-bridge/bridge.ts) — `WorkerBridge` class: constructor branches on whether a `script` arg is passed (parent, spawns `new Worker(script)`) or omitted (worker, requires `parentPort`); `request()` generates a `randomUUID()` correlation id, sends `{ ...data, __cid: cid }`, and races a `once(^event:res:cid$)` listener against a per-instance death promise
- [`src/core/worker-bridge/pool.ts`](../../src/core/worker-bridge/pool.ts) — `WorkerPool` class: constructs `Math.max(1, options.size)` `WorkerBridge` instances in the constructor, round-robins `request()` via `#nextIndex`, `shutdown()` awaits `Promise.all` of every worker's `shutdown()`
- [`src/core/worker-bridge/order-buffer.ts`](../../src/core/worker-bridge/order-buffer.ts) — `OrderBuffer<T>` class: `add(index, item)` buffers into a `Map<number, T>` and drains every contiguous entry starting at `#nextIndex`; throws on a non-integer index, an index below `#nextIndex`, or a duplicate index already in the buffer
- [`src/core/worker-bridge/pending-set.ts`](../../src/core/worker-bridge/pending-set.ts) — `PendingSet` class: `track(promise)` wraps the promise with `.then(() => undefined, () => undefined)` before adding it to a `Set`, so a rejected task still removes itself; `settleAny()` races the set, `settleAll()` loops `Promise.allSettled` until the set is empty
- [`src/core/worker-bridge/paths.ts`](../../src/core/worker-bridge/paths.ts) — `resolveWorker(name)`: returns `new URL('./workers/${name}.js', import.meta.url)` when `import.meta.url` contains `$bunfs` (compiled binary), otherwise `resolve(WORKER_DIR, '${name}.js')` where `WORKER_DIR = resolve(MODULE_DIR, '../../workers')`
- [`src/core/worker-bridge/types.ts`](../../src/core/worker-bridge/types.ts) — `WireMessage` (`{ event: string; data: unknown }`), `ResKey<K>` ([``](../..) `${K}:res` [``](../..) template type), `Correlated<T>` (`T & { __cid: string }`), `ConnectionEvents`, `ComputeEvents`, `PoolOptions`; imports `DtColumn`/`DtValue` from [`src/core/dt/types.ts`](../../src/core/dt/types.ts) and `Dialect` from [`src/core/connection/types.ts`](../../src/core/connection/types.ts)
- [`src/core/worker-bridge/index.ts`](../../src/core/worker-bridge/index.ts) — barrel export: `WorkerBridge`, `WorkerPool`, `OrderBuffer`, `resolveWorker`, and the `WireMessage`/`ResKey`/`Correlated`/`ConnectionEvents`/`ComputeEvents`/`PoolOptions` types (`PendingSet` is not re-exported here — importers reach it via `src/core/worker-bridge/pending-set.js` directly, as [`src/core/dt/index.ts`](../../src/core/dt/index.ts) does)
- [`src/workers/connection.ts`](../../src/workers/connection.ts) — connection worker entry point: builds a `Kysely` instance via `createDialectConnection`, which dynamically imports one of `src/core/connection/dialects/{sqlite-bun,sqlite,postgres,mysql,mssql}.js` based on the `dialect` argument (sqlite branches on `typeof globalThis.Bun`); handles `connect`, `disconnect`, `query`, `query:batch`, `execute`
- [`src/workers/compute.ts`](../../src/workers/compute.ts) — compute worker entry point: handles `serialize` (calls `serializeRow` from `src/core/dt/serialize.js`) and `deserialize` (calls `deserializeRow` from `src/core/dt/deserialize.js`), both wrapped in `attemptSync`

## Docs

None indexed.

## Coupling

- [`src/core/worker-bridge/types.ts`](../../src/core/worker-bridge/types.ts) imports `DtColumn`/`DtValue` from [`src/core/dt/types.ts`](../../src/core/dt/types.ts) and `Dialect` from [`src/core/connection/types.ts`](../../src/core/connection/types.ts) — changing those types' shapes changes the worker wire contract.
- [`src/core/dt/index.ts`](../../src/core/dt/index.ts) (sdk domain) is the primary consumer: it imports `WorkerPool`, `OrderBuffer`, `PendingSet`, and `resolveWorker` directly, constructs a `WorkerPool<ComputeEvents>` via `createDefaultComputePool()`, and uses `resolveWorker('compute')` to locate the compute worker script — a change to `ComputeEvents` in `types.ts` or to `compute.ts`'s handler shape requires a matching change in [`src/core/dt/index.ts`](../../src/core/dt/index.ts).
- [`src/core/connection/manager.ts`](../../src/core/connection/manager.ts) (core-db domain) imports `WorkerBridge` and `ConnectionEvents` as types, keeps a `Map<string, WorkerBridge<ConnectionEvents>>` in `#bridges`, and exposes `trackBridge(configName, bridge)` so the connection worker's `WorkerBridge` is shut down alongside regular connections on `app:shutdown`.
- [`src/cli/dev/test-workers.ts`](../../src/cli/dev/test-workers.ts) (cli domain) imports `resolveWorker`, `WorkerBridge`, and `WorkerBridge.pool` to run worker thread diagnostics against both `compute` and `connection` workers.
- `WorkerBridge` extends `ObserverRelay` from `@logosdx/observer` — its `on`/`once`/`off`/`emit`/`queue` methods and `receive()`/`shutdown()`/`isShutdown` come from that base class, not from this domain.
- [`src/workers/connection.ts`](../../src/workers/connection.ts) dynamically imports dialect factories from [`src/core/connection/dialects/`](../../src/core/connection/dialects) — adding a dialect there requires a matching branch in `createDialectConnection`.

## Conventions worth knowing

- Worker scripts live at [`src/workers/`](../../src/workers), a sibling of [`src/core/`](../../src/core), not inside [`src/core/worker-bridge/`](../../src/core/worker-bridge) — they are standalone entry points for `bun build --compile`, not library code.
- Never hardcode a worker script path; always resolve it through `resolveWorker(name)`. It handles three execution contexts differently: Bun dev mode resolves `.js` to `.ts` automatically, Node from `dist/` resolves to `dist/workers/*.js`, and a Bun-compiled binary resolves against `import.meta.url` inside `$bunfs` because `bun build --compile` strips the [`src/`](../../src) root and compiles `.ts` to `.js`.
- `request()`'s correlation id (`__cid`) is injected into the outgoing payload and echoed back in the response event name ([``](../..) `${event}:res:${cid}` [``](../..)); worker-side handlers destructure `__cid` from `data` (typed via `Correlated<T>`) to build that response event name.
- A `WorkerBridge` in parent mode listens for its worker's `exit` event; a nonzero exit code while not already shut down calls `#failPending`, which rejects every tracked pending request and stores `#deathError` so subsequent `request()` calls reject immediately rather than hanging.
- `OrderBuffer` and `PendingSet` exist because dispatching requests to a `WorkerPool` returns responses out of order and a naive `while (inFlight > 0) await sleep(1)` backpressure loop leaks its counter when a dispatch fails before reaching its downstream callback — both classes are designed around real promise settlement instead of a counter.
- [`src/core/worker-bridge/pending-set.ts`](../../src/core/worker-bridge/pending-set.ts)'s `track()` deliberately double-swallows rejections (the caller attaches its own handler first) so `settleAny`/`settleAll` never turn a task failure into an unhandled rejection.
