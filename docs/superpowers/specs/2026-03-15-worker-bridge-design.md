# WorkerBridge: Worker Thread Architecture for noorm


## Problem

The DT export/import pipeline runs entirely on the main thread — querying, type translation, serialization (gz64 encoding), file writing, compression, and encryption all execute sequentially. This produces ~50 rows/sec throughput and locks the TUI, preventing progress updates.

Beyond DT, all database operations (builds, changes, runners, schema exploration) block the main thread. The UI freezes during any long-running operation.


## Solution

An `ObserverRelay` subclass (`WorkerBridge`) that bridges `@logosdx/observer` across `worker_threads` via `postMessage`. Combined with a hub-and-spoke worker architecture:

- **Connection Worker** — persistent, reusable, owns a Kysely instance for all DB operations
- **Compute Pool** — ephemeral workers for CPU-bound serialization/deserialization, spun up per-operation
- **Main Thread** — orchestrates the pipeline, accumulates ordered results, writes to file, emits progress events to TUI


## Architecture


### Hub-and-Spoke Model

```
Main Thread (Orchestrator + DtWriter + TUI)
├── Connection Worker (persistent, 1 per active config)
│   └── owns Kysely, handles all DB ops across features
└── Compute Pool (ephemeral, N workers, spun up per DT operation)
    └── stateless: serializeRow() / deserializeRow()
```

The Connection Worker is general-purpose — it handles DT export/import today, but builds, changes, runners, and schema exploration will all route through it. The compute pool is DT-specific and ephemeral.

DtWriter stays on the main thread. Stream writes are non-blocking. One exception: `.dtzx` files run `gzipSync()` on the full buffer during `close()` — for large encrypted exports, this final compression step should be offloaded to a compute worker before writing.


### DT Export Pipeline

```
0. Orchestrator runs COUNT(*) via Connection Worker → totalRows for progress percentages
1. Main thread requests batch from Connection Worker
2. Connection Worker: SELECT ... LIMIT 1000 OFFSET N → returns { rows, offset, hasMore }
   → emit dt:export:loaded { loaded, totalRows }
3. Main thread fans out individual rows to compute workers (idle-worker dispatch)
   - Each row dispatched with its array index for ordering
4. Compute workers serialize each row → return { values, index }
   - Row-level dispatch balances load: a 2MB TEXT column hitting gz64 won't
     block a worker while others idle
   → emit dt:export:processed { processed, totalRows } (per row completion)
5. Main thread accumulates results in an order buffer (index → values map)
   - JSON5-stringifies values into lines and flushes to DtWriter when the next expected index arrives
   → emit dt:export:saved { saved, totalRows } (per flush)
6. Connection Worker pipelines: fetches next batch while compute workers process current
7. When hasMore: false, drain remaining compute results, DtWriter.close() (gzip/encrypt)
```

**Three-tier progress** enables the TUI to show three independent progress indicators:

| Event | Increments when | TUI display |
|-------|----------------|-------------|
| `dt:export:loaded` | A batch arrives from Connection Worker | "Loaded: 3000 / 50000 (6%)" |
| `dt:export:processed` | A compute worker finishes serializing a row | "Processed: 2847 / 50000 (5.7%)" |
| `dt:export:saved` | Order buffer flushes consecutive rows to DtWriter | "Saved: 2000 / 50000 (4%)" |

The three counters naturally trail each other: loaded >= processed >= saved. The gap between them visualizes the pipeline depth — a large loaded-to-processed gap means compute is the bottleneck, a large processed-to-saved gap means out-of-order results are buffering.

Individual rows carry their array index through the pipeline. Compute workers race — row 500 (2MB TEXT, 50ms gz64) finishes after rows 501-510 (simple ints, <1ms each). The order buffer on main thread reassembles them by index before flushing to file. The index is the ordering guarantee.


### DT Import Pipeline

The reverse flow. Total row count is derived from the file (line count after schema header):

```
1. DtReader reads 1000 lines via readline on main thread
   → emit dt:import:loaded { loaded, totalRows }
2. Individual lines dispatched to compute pool with index (idle-worker dispatch)
3. Compute workers deserialize → return { record, index }
   → emit dt:import:processed { processed, totalRows }
4. Main thread accumulates in order
5. Once a full batch is ordered, send to Connection Worker for batched INSERT
   → emit dt:import:saved { saved, totalRows }
6. Conflict handling (skip/update/replace/fail) executes in Connection Worker
7. Wait for the batch to drain (all 1000 processed + inserted), then read next 1000
```

Import uses pull-based flow: read a batch of 1000 lines, wait for the full pipeline to drain (deserialize + insert), then read the next 1000. This prevents unbounded memory growth from reading the file faster than the pipeline can consume — the file is the fastest stage, DB insertion is the slowest. The readline pauses naturally by not calling the next iteration until drain completes.


### Multi-Table Parallelism

For multi-table exports, the orchestrator runs N table pipelines concurrently. Each table gets its own DtWriter instance but shares the Connection Worker and compute pool. The Connection Worker handles interleaved `query:batch` requests from different tables via correlation IDs (`request()` method).


## WorkerBridge Core


### Class Design

Extends `ObserverRelay<TEvents, void>` from `@logosdx/observer`. Single class adapts based on context — with a script path it spawns a worker, without one it binds to `parentPort`.

```typescript
import { Worker, parentPort, workerData } from 'worker_threads'
import { ObserverRelay } from '@logosdx/observer'
import { randomUUID } from 'crypto'

type Port = Worker | import('worker_threads').MessagePort

interface WireMessage {
    event: string
    data: unknown
}

type ResKey<K extends string> = `${K}:res`

function isTransferable(data: unknown): data is { __transfer: Transferable[] } {
    return !!data && typeof data === 'object' && '__transfer' in data
}

class WorkerBridge<TEvents extends Record<string, object>> extends ObserverRelay<TEvents, void> {

    #port: Port
    #ownsWorker: boolean

    constructor(script?: string, data?: unknown) {
        const isParent = !!script
        super({ name: isParent ? 'bridge:parent' : 'bridge:worker' })

        if (script) {
            this.#port = new Worker(script, { workerData: data })
            this.#ownsWorker = true
        } else {
            if (!parentPort) {
                throw new Error(
                    'WorkerBridge: no script provided and not in a worker thread'
                )
            }
            this.#port = parentPort
            this.#ownsWorker = false
        }

        this.#port.on('message', (msg: WireMessage) => {
            this.receive(msg.event, msg.data, undefined as void)
        })
    }

    protected send(event: string, data: unknown): void {
        if (isTransferable(data)) {
            this.#port.postMessage({ event, data }, data.__transfer)
        } else {
            this.#port.postMessage({ event, data })
        }
    }

    async request<K extends keyof TEvents & string>(
        event: K,
        data: TEvents[K],
        options?: { signal?: AbortSignal }
    ): Promise<ResKey<K> extends keyof TEvents ? TEvents[ResKey<K>] : unknown> {
        const cid = randomUUID()
        const pending = this.once(new RegExp(`^${event}:res:${cid}$`), options)
        this.send(event, { ...data, __cid: cid })
        const { data: { data: result } } = await pending
        return result
    }

    transfer<K extends keyof TEvents & string>(
        event: K,
        data: TEvents[K],
        transferables: Transferable[]
    ): void {
        this.#port.postMessage({ event, data }, transferables)
    }

    static get workerData() {
        return workerData
    }

    // Note: base ObserverRelay.shutdown() is synchronous (void).
    // This override returns Promise<void> to await worker termination.
    // Callers holding a WorkerBridge reference (not a base class ref) get the Promise.
    async shutdown(): Promise<void> {
        super.shutdown()
        if (this.#ownsWorker && 'terminate' in this.#port) {
            await this.#port.terminate()
        }
    }
}
```


### Compute Pool

Static factory on WorkerBridge. Holds N identical workers, dispatches to the next idle worker (not pure round-robin — skips busy workers to prevent hot spots from rows with varying serialization costs).

```typescript
import { availableParallelism } from 'os'

const pool = WorkerBridge.pool<ComputeEvents>(
    './src/workers/compute.ts',
    { size: Math.max(1, availableParallelism() - 2) }
)

// pool.request() dispatches to next idle worker
// pool.on() aggregates events from all workers
// pool.shutdown() terminates all workers
```

Pool is ephemeral — spawned when a DT operation starts, shut down when it completes. Size reserves threads for main thread and connection worker.


### Bun Single Binary Compatibility

Worker scripts use string paths, not `new URL()`. Inside a compiled binary, `import.meta.url` resolves to `file:///$bunfs/root/<binary-name>`, causing `ModuleNotFound` for URL-resolved paths. String paths match `bun build --compile` entry points and resolve correctly in both dev and compiled modes.


## Event Contracts


### ConnectionEvents

```typescript
interface ConnectionEvents {
    'connect': { dialect: string; connectionString: string }
    'connect:res': { success: boolean; error?: string }
    'disconnect': {}
    'disconnect:res': {}
    'query': { sql: string; params?: unknown[] }
    'query:res': { rows: unknown[]; error?: string }
    'query:batch': { sql: string; params?: unknown[]; batchSize: number; offset: number }
    'query:batch:res': { rows: unknown[]; offset: number; hasMore: boolean; error?: string }
    'execute': { sql: string; params?: unknown[] }
    'execute:res': { affectedRows: number; error?: string }
}
```

General-purpose — every feature that touches the database uses this contract. The `query:batch` event handles paginated reads with offset tracking and `hasMore` signaling. All response events include an optional `error` field — when present, the orchestrator propagates it via the existing `attempt()` error tuple pattern.


### ComputeEvents

```typescript
interface ComputeEvents {
    'serialize': { row: Record<string, unknown>; columns: DtColumn[]; index: number }
    'serialize:res': { values: DtValue[]; index: number; error?: string }
    'deserialize': { values: DtValue[]; columns: DtColumn[]; targetDialect: string; targetVersion?: string; index: number }
    'deserialize:res': { record: Record<string, unknown>; index: number; error?: string }
}
```

Single-row granularity. Each row carries its array index through the pipeline so the main thread can reassemble results in order regardless of which worker finishes first.

`serializeRow()` accepts `{ row, columns }` and returns `DtValue[]` — the serialized values array. The main thread JSON5-stringifies the values into a line before writing to DtWriter. This keeps the worker focused on the CPU-bound encoding (gz64) and leaves the lightweight stringification to the main thread.

`deserializeRow()` accepts `{ values, columns, targetDialect, targetVersion }` — the event contract mirrors this options object. The `targetDialect` is needed because deserialization applies dialect-specific conversions (e.g., PostgreSQL native JSON vs MSSQL nvarchar workaround). Serialization omits dialect because it's dialect-agnostic.


### Correlation Protocol

The `request()` method adds a `__cid` (correlation ID) to outgoing data and awaits a regex-matched response. Worker scripts must follow this contract:

```typescript
// Worker side — extract __cid, emit response with cid-suffixed event name
const bridge = new WorkerBridge<ConnectionEvents>()

bridge.on('query', async ({ data: { sql, params, __cid } }) => {
    const [rows, err] = await attempt(() => kysely.raw(sql, params))
    if (err) {
        bridge.emit(`query:res:${__cid}`, { rows: [], error: err.message })
    } else {
        bridge.emit(`query:res:${__cid}`, { rows })
    }
})
```

The parent's `request('query', { sql })` internally emits `query` with `{ sql, __cid: uuid }`, then awaits `once(/^query:res:<uuid>$/)`. The worker extracts `__cid` from the incoming data, processes the request, and emits the response on the cid-suffixed event name. This is the contract all worker scripts must implement for `request()` to work.


## Lifecycle


### Connection Worker

Tied to config activation. Spawned when the user activates a database config or connects. Persists across features — DT export, then a build, then a change execution all reuse the same worker. Shuts down on config deactivation, disconnect, or app shutdown.

Maps to the existing `ConnectionManager` singleton. Today it holds Kysely instances directly. With workers, it holds a `WorkerBridge<ConnectionEvents>` instead. The interface to consumers stays the same.


### Compute Pool

Ephemeral. Spawned when a DT operation starts, sized to `Math.max(1, os.availableParallelism() - 2)` (reserve one for main thread, one for connection worker; floor of 1 for low-core environments like CI containers). Shut down when the operation completes.


### Shutdown Coordination

Hooks into the existing `LifecycleManager` phased shutdown (`stopping → completing → releasing → flushing → exiting`):

- **completing**: drain in-flight compute work, finish current batch write
- **releasing**: `connectionWorker.shutdown()` (terminates worker, closes DB connection inside it)

If shutdown happens mid-export, the compute pool gets `pool.shutdown()` during `completing` for clean termination.


### Observer Event Relay

The Connection Worker emits events (`connection:open`, `connection:error`, etc.) through the bridge. The orchestrator on main thread relays these to the shared `observer` instance so TUI screens and hooks react the same way they do today. No changes needed to existing TUI screens or hooks.


### Shutdown Listener Reconciliation

The existing `ConnectionManager` has its own `app:shutdown` listener (line 55 of manager.ts), and `LifecycleManager` registers a `connections` resource in the `releasing` phase. When `ConnectionManager` switches to holding `WorkerBridge` instances, its self-managed shutdown listener calls `bridge.shutdown()` instead of `kysely.destroy()`. The `LifecycleManager` resource registration remains unchanged — it still calls `getConnectionManager().closeAll()`, which internally shuts down the bridge.


## File Structure

```
src/core/worker-bridge/
├── bridge.ts              # WorkerBridge class (ObserverRelay subclass)
├── pool.ts                # pool() static factory + round-robin logic
├── types.ts               # WireMessage, ResKey, shared type utilities
└── index.ts               # Public API barrel

src/workers/
├── connection.ts          # Persistent DB worker (Kysely, query, execute)
└── compute.ts             # Stateless serialization/deserialization
```

Worker scripts live at `src/workers/` (top level, not nested in `core/`) because they're entry points for `bun build --compile`, not library code. They import from `src/core/` but are standalone programs.


### Build Script Changes

`scripts/build-binary.mjs` adds worker entry points:

```bash
bun build --compile \
    src/cli/index.tsx \
    src/workers/connection.ts \
    src/workers/compute.ts
```


## Backpressure

The orchestrator caps in-flight rows dispatched to the compute pool. The cap is based on two thresholds:

- **Max pending rows**: `batchSize * 3` (default 3000) — if the order buffer holds more than this many unwritten results, stop requesting new batches from the Connection Worker
- **Scope**: per-table, not global — each table pipeline manages its own buffer independently

The mechanism is simple: the orchestrator stops calling `request('query:batch')` until the buffer drains below threshold. Since `query:batch` is request/response, not a push stream, the Connection Worker naturally idles when not asked for more. No explicit pause/resume signaling needed.


## Worker Crash Recovery

**Compute worker crash**: the orchestrator detects the worker's `exit` event. The in-flight row dispatched to that worker is lost. Strategy: abort the current export/import operation with an error. The pool is ephemeral — a partial export with missing rows is worse than a clean failure. The user retries the operation, which spawns a fresh pool.

**Connection Worker crash**: the DB connection is lost. The orchestrator detects the `exit` event and emits `connection:error` to the shared observer. Strategy: abort the current operation. The `ConnectionManager` can respawn a new Connection Worker on the next operation or connection attempt. No automatic retry of the lost operation — the user or calling code decides.


## What Changes in Existing Code

- **`src/core/dt/index.ts`**: `exportTable()` and `importDtFile()` refactored to use workers instead of inline processing. The orchestration logic (pipeline coordination, order buffer) replaces the current synchronous loop.
- **`src/core/connection/manager.ts`**: Holds `WorkerBridge<ConnectionEvents>` instead of direct Kysely instances.
- **`scripts/build-binary.mjs`**: Adds worker entry points to the compile command.
- **`src/core/dt/serialize.ts`** and **`src/core/dt/deserialize.ts`**: No changes — these are imported by `src/workers/compute.ts` as-is.
- **TUI screens and hooks**: No changes — they subscribe to the same observer events.


## Worker Script Examples


### Connection Worker (`src/workers/connection.ts`)

```typescript
import { WorkerBridge } from '../core/worker-bridge/index.js'
import type { ConnectionEvents } from '../core/worker-bridge/types.js'
import { attempt } from '@logosdx/utils'

const bridge = new WorkerBridge<ConnectionEvents>()
const config = WorkerBridge.workerData
let kysely: Kysely<any>

bridge.on('connect', async ({ data: { dialect, connectionString, __cid } }) => {
    const [instance, err] = await attempt(() => createKysely({ dialect, connectionString }))
    if (err) {
        bridge.emit(`connect:res:${__cid}`, { success: false, error: err.message })
    } else {
        kysely = instance
        bridge.emit(`connect:res:${__cid}`, { success: true })
    }
})

bridge.on('query:batch', async ({ data: { sql, params, batchSize, offset, __cid } }) => {
    const [rows, err] = await attempt(() => kysely.raw(sql, params))
    if (err) {
        bridge.emit(`query:batch:res:${__cid}`, { rows: [], offset, hasMore: false, error: err.message })
    } else {
        bridge.emit(`query:batch:res:${__cid}`, {
            rows,
            offset,
            hasMore: rows.length === batchSize
        })
    }
})
```


### Compute Worker (`src/workers/compute.ts`)

```typescript
import { WorkerBridge } from '../core/worker-bridge/index.js'
import type { ComputeEvents } from '../core/worker-bridge/types.js'
import { attemptSync } from '@logosdx/utils'
import { serializeRow } from '../core/dt/serialize.js'
import { deserializeRow } from '../core/dt/deserialize.js'

const bridge = new WorkerBridge<ComputeEvents>()

bridge.on('serialize', ({ data: { row, columns, index, __cid } }) => {
    const [values, err] = attemptSync(() => serializeRow({ row, columns }))
    if (err) {
        bridge.emit(`serialize:res:${__cid}`, { values: [], index, error: err.message })
    } else {
        bridge.emit(`serialize:res:${__cid}`, { values, index })
    }
})

bridge.on('deserialize', ({ data: { values, columns, targetDialect, targetVersion, index, __cid } }) => {
    const [record, err] = attemptSync(() => deserializeRow({ values, columns, targetDialect, targetVersion }))
    if (err) {
        bridge.emit(`deserialize:res:${__cid}`, { record: {}, index, error: err.message })
    } else {
        bridge.emit(`deserialize:res:${__cid}`, { record, index })
    }
})
```


## Testing Strategy

**Unit tests** (`tests/core/worker-bridge/`):
- `bridge.test.ts` — WorkerBridge class: spawn/bind detection, send/receive roundtrip, request/response correlation, shutdown lifecycle. Uses a minimal echo worker script in `tests/fixtures/workers/echo.ts`.
- `pool.test.ts` — pool factory: idle-worker dispatch, aggregated `on()`, shutdown of all workers.
- `order-buffer.test.ts` — order buffer logic: in-order flush, out-of-order accumulation, gap handling.

**Integration tests** (`tests/core/dt/`):
- Extend existing DT roundtrip tests to run through the worker pipeline. Same assertions (serialize → write → read → deserialize produces identical data), different execution path.
- The existing 11 DT test files (`serialize.test.ts`, `deserialize.test.ts`, etc.) remain unchanged — they test the pure functions that workers import.

**Worker script tests** (`tests/workers/`):
- `connection.test.ts` — Connection Worker with a real database (SQLite for CI). Verify query, query:batch pagination, execute, error propagation.
- `compute.test.ts` — Compute Worker end-to-end. Send a row, receive serialized line, verify correctness.

**CI considerations**: worker_threads require real OS threads. No mocking needed — tests spawn actual workers. Bun's test runner handles this natively. Tests run in `tmp/` per project convention.


## Design Properties

- **Relay-based**: extends `ObserverRelay` — inherits `spy()`, `$facts()`, `$internals()`, signal-based shutdown
- **Transparent boundary**: consumers use `.on()` / `.emit()` — same API as in-process observer code
- **Reusable Connection Worker**: general-purpose DB worker, not tied to DT — builds, changes, runners all route through it
- **Ephemeral compute**: pool spun up per-operation, no wasted resources during non-DT work
- **Row-level parallelism**: individual rows dispatched to compute workers with array index for ordered reassembly
- **Crash isolation**: worker crash doesn't take down the main thread
- **Index-ordered output**: order buffer guarantees file output matches DB query order regardless of worker completion timing
- **Backpressure**: capped in-flight work prevents unbounded memory growth
- **Single binary**: worker scripts bundle into `bun build --compile` output via string path resolution
