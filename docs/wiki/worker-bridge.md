---
type: Domain
---

# worker-bridge

## What it does

Hub-and-spoke worker thread infrastructure. `WorkerBridge` (an `ObserverRelay` subclass) owns message routing between main thread and worker threads. `WorkerPool` provides round-robin dispatch to N workers. `OrderBuffer` reassembles index-ordered responses. Used for CPU-bound DT serialization/deserialization and for the persistent DB connection worker.

## CLI code

- `src/core/worker-bridge/bridge.ts` — `WorkerBridge`; ObserverRelay subclass, message correlation, error propagation
- `src/core/worker-bridge/pool.ts` — `WorkerPool`; round-robin N-worker dispatch
- `src/core/worker-bridge/order-buffer.ts` — `OrderBuffer`; index-ordered response reassembly
- `src/core/worker-bridge/paths.ts` — `resolveWorker`; path resolution for dev/compiled contexts
- `src/core/worker-bridge/types.ts` — `WireMessage`, `Correlated`, event contract types
- `src/workers/connection.ts` — persistent DB worker entry point; owns Kysely instance, handles all DB ops
- `src/workers/compute.ts` — stateless compute worker entry point; serialize/deserialize for DT pipeline

## Docs

- `docs/dev/README.md` — worker bridge architecture overview (section in monorepo dev guide)

## Coupling

- `resolveWorker` is called wherever a worker is spawned — never hardcode worker paths.
- `WorkerBridge` extends `ObserverRelay` from `@logosdx/observer` — observer domain is a dependency.
- DT module (`src/core/dt/`) spawns compute workers via `WorkerPool` — DT changes may require worker message-type updates.
- Connection worker (`src/workers/connection.ts`) holds the Kysely instance used by runner and change executor in worker contexts — worker restart resets all in-flight operations.
- Bun `--compile` binary path resolution: `src/workers/compute.ts` → `workers/compute.js` in `$bunfs` — the `IS_COMPILED` guard in `paths.ts` handles this.

## Conventions worth knowing

- `IS_COMPILED = import.meta.url.includes('$bunfs')` detects compiled binary context.
- In compiled binary: `new URL('./workers/${name}.js', import.meta.url)` resolves against `$bunfs`.
- In dev/dist: `resolve(WORKER_DIR, '${name}.js')` resolves to absolute path.
- `noorm dev test-workers` runs 5 worker thread tests across all execution contexts.
- `WireMessage` carries a correlation ID for request-response matching across thread boundary.
- `OrderBuffer` is needed when worker results arrive out-of-order (e.g., concurrent compute workers).
