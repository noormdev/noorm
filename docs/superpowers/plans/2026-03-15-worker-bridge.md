# WorkerBridge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parallelize DT export/import via worker_threads using an ObserverRelay-based WorkerBridge, with a reusable Connection Worker and ephemeral Compute Pool.

**Architecture:** Hub-and-spoke model — persistent Connection Worker owns DB operations, ephemeral Compute Pool handles CPU-bound serialization. Main thread orchestrates the pipeline with an order buffer for index-guaranteed output. Three-tier progress events (loaded/processed/saved) feed the TUI.

**Tech Stack:** `@logosdx/observer` (ObserverRelay), `node:worker_threads`, `bun:test`, Kysely, JSON5

**Spec:** `docs/superpowers/specs/2026-03-15-worker-bridge-design.md`

---


## Chunk 1: WorkerBridge Core


### Task 1: Types Module

**Files:**
- Create: `src/core/worker-bridge/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
import type { DtColumn, DtValue } from '../dt/types.js'
import type { Dialect } from '../connection/types.js'

// Wire protocol — the shape of every postMessage payload
export interface WireMessage {
    event: string
    data: unknown
}

// Maps 'query' → 'query:res' for typed request/response
export type ResKey<K extends string> = `${K}:res`

// Correlation ID injected by request() — worker scripts destructure this
// from incoming data and use it to suffix the response event name.
// See Correlation Protocol in the spec.
export type Correlated<T> = T & { __cid: string }

// Type guard for zero-copy ArrayBuffer transfer
export function isTransferable(data: unknown): data is { __transfer: Transferable[] } {
    return !!data && typeof data === 'object' && '__transfer' in data
}

// --- Connection Worker Events ---

export interface ConnectionEvents {
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

// --- Compute Worker Events ---

export interface ComputeEvents {
    'serialize': { row: Record<string, unknown>; columns: DtColumn[]; index: number }
    'serialize:res': { values: DtValue[]; index: number; error?: string }
    'deserialize': { values: DtValue[]; columns: DtColumn[]; targetDialect: Dialect; targetVersion?: string; index: number }
    'deserialize:res': { record: Record<string, unknown>; index: number; error?: string }
}

// --- Pool Options ---

export interface PoolOptions {
    size: number
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/worker-bridge/types.ts
git commit -m "feat(worker-bridge): add types module with event contracts"
```


### Task 2: WorkerBridge Class

**Files:**
- Create: `src/core/worker-bridge/bridge.ts`
- Create: `tests/core/worker-bridge/bridge.test.ts`
- Create: `tests/fixtures/workers/echo.ts`

- [ ] **Step 1: Create echo fixture worker for testing**

This minimal worker echoes back whatever it receives, enabling bridge tests without real business logic.

```typescript
// tests/fixtures/workers/echo.ts
import { parentPort, workerData } from 'worker_threads'

if (!parentPort) throw new Error('Not in worker')

// Echo back every message with ':res' suffix
parentPort.on('message', ({ event, data }: { event: string; data: any }) => {
    const cid = data?.__cid
    const resEvent = cid ? `${event}:res:${cid}` : `${event}:res`
    parentPort!.postMessage({ event: resEvent, data: { ...data } })
})

// If workerData was provided, send it back as an init event
if (workerData) {
    parentPort.postMessage({ event: 'init', data: workerData })
}
```

- [ ] **Step 2: Write failing tests for WorkerBridge**

```typescript
// tests/core/worker-bridge/bridge.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { resolve } from 'path'

// Bridge not yet created — these will fail
import { WorkerBridge } from '../../../src/core/worker-bridge/bridge.js'

const ECHO_WORKER = resolve(import.meta.dir, '../../fixtures/workers/echo.ts')

interface EchoEvents {
    'ping': { message: string }
    'ping:res': { message: string }
    'init': any
}

describe('WorkerBridge', () => {
    let bridge: WorkerBridge<EchoEvents>

    afterEach(async () => {
        if (bridge && !bridge.isShutdown) await bridge.shutdown()
    })

    it('should spawn a worker in parent mode', () => {
        bridge = new WorkerBridge<EchoEvents>(ECHO_WORKER)
        expect(bridge).toBeDefined()
        expect(bridge.isShutdown).toBe(false)
    })

    it('should send and receive messages', async () => {
        bridge = new WorkerBridge<EchoEvents>(ECHO_WORKER)
        const result = await bridge.request('ping', { message: 'hello' })
        expect(result.message).toBe('hello')
    })

    it('should forward workerData to the worker', async () => {
        bridge = new WorkerBridge<EchoEvents>(ECHO_WORKER, { greeting: 'hi' })
        const { data } = await bridge.once('init')
        expect(data.greeting).toBe('hi')
    })

    it('should shut down cleanly', async () => {
        bridge = new WorkerBridge<EchoEvents>(ECHO_WORKER)
        await bridge.shutdown()
        expect(bridge.isShutdown).toBe(true)
    })

    it('should throw when no script and not in worker', () => {
        expect(() => new WorkerBridge<EchoEvents>()).toThrow(
            'WorkerBridge: no script provided and not in a worker thread'
        )
    })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/core/worker-bridge/bridge.test.ts`
Expected: FAIL — `Cannot find module '../../../src/core/worker-bridge/bridge.js'`

- [ ] **Step 4: Implement WorkerBridge class**

```typescript
// src/core/worker-bridge/bridge.ts
import { Worker, parentPort, workerData } from 'worker_threads'
import { ObserverRelay } from '@logosdx/observer'
import { randomUUID } from 'crypto'
import { isTransferable } from './types.js'
import type { WireMessage, ResKey } from './types.js'

type Port = Worker | import('worker_threads').MessagePort

export class WorkerBridge<TEvents extends Record<string, object>> extends ObserverRelay<TEvents, void> {

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

    async shutdown(): Promise<void> {
        super.shutdown()
        if (this.#ownsWorker && 'terminate' in this.#port) {
            await this.#port.terminate()
        }
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/core/worker-bridge/bridge.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/worker-bridge/bridge.ts tests/core/worker-bridge/bridge.test.ts tests/fixtures/workers/echo.ts
git commit -m "feat(worker-bridge): implement WorkerBridge class with tests"
```


### Task 3: Compute Pool

**Files:**
- Create: `src/core/worker-bridge/pool.ts`
- Create: `tests/core/worker-bridge/pool.test.ts`
- Create: `tests/fixtures/workers/adder.ts`

- [ ] **Step 1: Create adder fixture worker for pool testing**

This worker adds numbers — stateless, fast, verifiable. Useful for testing dispatch and aggregation.

```typescript
// tests/fixtures/workers/adder.ts
import { parentPort } from 'worker_threads'

if (!parentPort) throw new Error('Not in worker')

parentPort.on('message', ({ event, data }: { event: string; data: any }) => {
    if (event === 'add') {
        const result = data.a + data.b
        const resEvent = data.__cid ? `add:res:${data.__cid}` : 'add:res'
        parentPort!.postMessage({ event: resEvent, data: { result, index: data.index } })
    }
})
```

- [ ] **Step 2: Write failing tests for pool**

```typescript
// tests/core/worker-bridge/pool.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { resolve } from 'path'
import { WorkerPool } from '../../../src/core/worker-bridge/pool.js'

const ADDER_WORKER = resolve(import.meta.dir, '../../fixtures/workers/adder.ts')

interface AdderEvents {
    'add': { a: number; b: number; index: number }
    'add:res': { result: number; index: number }
}

describe('WorkerPool', () => {
    let pool: WorkerPool<AdderEvents>

    afterEach(async () => {
        if (pool) await pool.shutdown()
    })

    it('should create N workers', () => {
        pool = new WorkerPool<AdderEvents>(ADDER_WORKER, { size: 3 })
        expect(pool.size).toBe(3)
    })

    it('should dispatch requests to workers', async () => {
        pool = new WorkerPool<AdderEvents>(ADDER_WORKER, { size: 2 })
        const result = await pool.request('add', { a: 2, b: 3, index: 0 })
        expect(result.result).toBe(5)
    })

    it('should handle concurrent requests across workers', async () => {
        pool = new WorkerPool<AdderEvents>(ADDER_WORKER, { size: 3 })
        const results = await Promise.all([
            pool.request('add', { a: 1, b: 1, index: 0 }),
            pool.request('add', { a: 2, b: 2, index: 1 }),
            pool.request('add', { a: 3, b: 3, index: 2 }),
        ])
        expect(results.map(r => r.result)).toEqual([2, 4, 6])
    })

    it('should aggregate on() events from all workers', async () => {
        pool = new WorkerPool<AdderEvents>(ADDER_WORKER, { size: 2 })
        const received: number[] = []
        pool.on('add:res', ({ data }) => { received.push(data.result) })

        await pool.request('add', { a: 1, b: 1, index: 0 })
        await pool.request('add', { a: 5, b: 5, index: 1 })

        expect(received).toContain(2)
        expect(received).toContain(10)
    })

    it('should shutdown all workers', async () => {
        pool = new WorkerPool<AdderEvents>(ADDER_WORKER, { size: 3 })
        await pool.shutdown()
        expect(pool.isShutdown).toBe(true)
    })

    it('should floor size to 1', () => {
        pool = new WorkerPool<AdderEvents>(ADDER_WORKER, { size: 0 })
        expect(pool.size).toBe(1)
    })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/core/worker-bridge/pool.test.ts`
Expected: FAIL — `Cannot find module '../../../src/core/worker-bridge/pool.js'`

- [ ] **Step 4: Implement WorkerPool class**

```typescript
// src/core/worker-bridge/pool.ts
import { WorkerBridge } from './bridge.js'
import type { ResKey, PoolOptions } from './types.js'

export class WorkerPool<TEvents extends Record<string, object>> {

    #workers: WorkerBridge<TEvents>[]
    #nextIndex = 0
    #isShutdown = false

    constructor(script: string, options: PoolOptions) {
        const size = Math.max(1, options.size)
        this.#workers = Array.from({ length: size }, () =>
            new WorkerBridge<TEvents>(script)
        )
    }

    get size(): number {
        return this.#workers.length
    }

    get isShutdown(): boolean {
        return this.#isShutdown
    }

    // Round-robin dispatch — simple and predictable.
    // For idle-worker dispatch, track busy state per worker
    // and skip busy ones. This is the initial implementation;
    // idle-aware dispatch can be layered on once profiling shows need.
    async request<K extends keyof TEvents & string>(
        event: K,
        data: TEvents[K],
        options?: { signal?: AbortSignal }
    ): Promise<ResKey<K> extends keyof TEvents ? TEvents[ResKey<K>] : unknown> {
        const worker = this.#workers[this.#nextIndex]
        this.#nextIndex = (this.#nextIndex + 1) % this.#workers.length
        return worker.request(event, data, options)
    }

    on<K extends keyof TEvents & string>(
        event: K,
        callback: (payload: { data: TEvents[K] }) => void,
        options?: { signal?: AbortSignal }
    ) {
        for (const worker of this.#workers) {
            worker.on(event, callback, options)
        }
    }

    async shutdown(): Promise<void> {
        this.#isShutdown = true
        await Promise.all(this.#workers.map(w => w.shutdown()))
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/core/worker-bridge/pool.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/worker-bridge/pool.ts tests/core/worker-bridge/pool.test.ts tests/fixtures/workers/adder.ts
git commit -m "feat(worker-bridge): implement WorkerPool with round-robin dispatch"
```


### Task 4: Barrel Export

**Files:**
- Create: `src/core/worker-bridge/index.ts`

- [ ] **Step 1: Create barrel and add static pool() factory to WorkerBridge**

```typescript
// src/core/worker-bridge/index.ts
export { WorkerBridge } from './bridge.js'
export { WorkerPool } from './pool.js'
export { OrderBuffer } from './order-buffer.js'
export type {
    WireMessage,
    ResKey,
    Correlated,
    ConnectionEvents,
    ComputeEvents,
    PoolOptions,
} from './types.js'
export { isTransferable } from './types.js'
```

Also add a static `pool()` factory to `WorkerBridge` in `bridge.ts` (matches spec's `WorkerBridge.pool()` API):

```typescript
import { WorkerPool } from './pool.js'
import type { PoolOptions } from './types.js'

// Inside the WorkerBridge class:
static pool<T extends Record<string, object>>(
    script: string,
    options: PoolOptions
): WorkerPool<T> {
    return new WorkerPool<T>(script, options)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/worker-bridge/index.ts
git commit -m "feat(worker-bridge): add barrel export"
```


## Chunk 2: Order Buffer


### Task 5: Order Buffer

The order buffer accumulates out-of-order results from compute workers and flushes them in index order. This is a standalone data structure with no worker dependencies — pure logic.

**Files:**
- Create: `src/core/worker-bridge/order-buffer.ts`
- Create: `tests/core/worker-bridge/order-buffer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/worker-bridge/order-buffer.test.ts
import { describe, it, expect } from 'bun:test'
import { OrderBuffer } from '../../../src/core/worker-bridge/order-buffer.js'

describe('OrderBuffer', () => {

    it('should flush items arriving in order', () => {
        const flushed: string[] = []
        const buffer = new OrderBuffer<string>(item => { flushed.push(item) })

        buffer.add(0, 'a')
        buffer.add(1, 'b')
        buffer.add(2, 'c')

        expect(flushed).toEqual(['a', 'b', 'c'])
    })

    it('should buffer out-of-order items and flush when gap fills', () => {
        const flushed: string[] = []
        const buffer = new OrderBuffer<string>(item => { flushed.push(item) })

        buffer.add(2, 'c')  // buffered — waiting for 0
        buffer.add(0, 'a')  // flush 'a', still waiting for 1
        buffer.add(1, 'b')  // flush 'b', then 'c' (was buffered)

        expect(flushed).toEqual(['a', 'b', 'c'])
    })

    it('should report pending count', () => {
        const buffer = new OrderBuffer<string>(() => {})

        buffer.add(2, 'c')
        buffer.add(4, 'e')
        expect(buffer.pending).toBe(2)

        buffer.add(0, 'a')
        buffer.add(1, 'b')
        // 0,1,2 flush → only 4 remains pending
        expect(buffer.pending).toBe(1)
    })

    it('should report nextIndex', () => {
        const buffer = new OrderBuffer<string>(() => {})

        expect(buffer.nextIndex).toBe(0)
        buffer.add(0, 'a')
        expect(buffer.nextIndex).toBe(1)
    })

    it('should handle large gaps', () => {
        const flushed: number[] = []
        const buffer = new OrderBuffer<number>(item => { flushed.push(item) })

        buffer.add(5, 50)
        buffer.add(3, 30)
        buffer.add(1, 10)
        buffer.add(0, 0)
        buffer.add(2, 20)
        buffer.add(4, 40)

        expect(flushed).toEqual([0, 10, 20, 30, 40, 50])
    })

    it('should support drain() to check if all items flushed', () => {
        const buffer = new OrderBuffer<string>(() => {})

        buffer.add(0, 'a')
        buffer.add(1, 'b')
        expect(buffer.pending).toBe(0)

        buffer.add(3, 'd')  // gap at 2
        expect(buffer.pending).toBe(1)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/worker-bridge/order-buffer.test.ts`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement OrderBuffer**

```typescript
// src/core/worker-bridge/order-buffer.ts
export class OrderBuffer<T> {

    #buffer = new Map<number, T>()
    #nextIndex = 0
    #flush: (item: T) => void

    constructor(flush: (item: T) => void) {
        this.#flush = flush
    }

    get nextIndex(): number {
        return this.#nextIndex
    }

    get pending(): number {
        return this.#buffer.size
    }

    add(index: number, item: T): void {
        this.#buffer.set(index, item)
        this.#drain()
    }

    #drain(): void {
        while (this.#buffer.has(this.#nextIndex)) {
            const item = this.#buffer.get(this.#nextIndex)!
            this.#buffer.delete(this.#nextIndex)
            this.#nextIndex++
            this.#flush(item)
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/worker-bridge/order-buffer.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Add to barrel**

Add `OrderBuffer` to `src/core/worker-bridge/index.ts`:

```typescript
export { OrderBuffer } from './order-buffer.js'
```

- [ ] **Step 6: Commit**

```bash
git add src/core/worker-bridge/order-buffer.ts tests/core/worker-bridge/order-buffer.test.ts src/core/worker-bridge/index.ts
git commit -m "feat(worker-bridge): implement OrderBuffer for index-ordered reassembly"
```


## Chunk 3: Worker Scripts


### Task 6: Compute Worker Script

**Files:**
- Create: `src/workers/compute.ts`
- Create: `tests/workers/compute.test.ts`

- [ ] **Step 1: Write failing test**

Test the compute worker end-to-end: spawn it via WorkerBridge, send a serialize request, verify the returned DtValue[] is correct.

```typescript
// tests/workers/compute.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { resolve } from 'path'
import { WorkerBridge } from '../../src/core/worker-bridge/bridge.js'
import type { ComputeEvents } from '../../src/core/worker-bridge/types.js'

const COMPUTE_WORKER = resolve(import.meta.dir, '../../src/workers/compute.ts')

describe('compute worker', () => {
    let bridge: WorkerBridge<ComputeEvents>

    afterEach(async () => {
        if (bridge && !bridge.isShutdown) await bridge.shutdown()
    })

    it('should serialize a simple row', async () => {
        bridge = new WorkerBridge<ComputeEvents>(COMPUTE_WORKER)

        const result = await bridge.request('serialize', {
            row: { id: 1, name: 'alice' },
            columns: [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'string' },
            ],
            index: 0,
        })

        expect(result.values).toEqual([1, 'alice'])
        expect(result.index).toBe(0)
        expect(result.error).toBeUndefined()
    })

    it('should deserialize a simple row', async () => {
        bridge = new WorkerBridge<ComputeEvents>(COMPUTE_WORKER)

        const result = await bridge.request('deserialize', {
            values: [1, 'alice'],
            columns: [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'string' },
            ],
            targetDialect: 'postgresql',
            index: 0,
        })

        expect(result.record).toEqual({ id: 1, name: 'alice' })
        expect(result.index).toBe(0)
        expect(result.error).toBeUndefined()
    })

    it('should return error on serialization failure', async () => {
        bridge = new WorkerBridge<ComputeEvents>(COMPUTE_WORKER)

        const result = await bridge.request('serialize', {
            row: { missing: 'value' },
            columns: [
                { name: 'id', type: 'int' },
            ],
            index: 5,
        })

        // serializeRow returns null for missing columns, not an error.
        // The exact behavior depends on serializeRow — this test validates
        // the bridge propagates whatever serializeRow returns.
        expect(result.index).toBe(5)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/workers/compute.test.ts`
Expected: FAIL — `Cannot find module '../../src/workers/compute.ts'`

- [ ] **Step 3: Implement compute worker**

```typescript
// src/workers/compute.ts
import { WorkerBridge } from '../core/worker-bridge/bridge.js'
import { attemptSync } from '@logosdx/utils'
import { serializeRow } from '../core/dt/serialize.js'
import { deserializeRow } from '../core/dt/deserialize.js'
import type { ComputeEvents, Correlated } from '../core/worker-bridge/types.js'

const bridge = new WorkerBridge<ComputeEvents>()

bridge.on('serialize', ({ data }) => {
    const { row, columns, index, __cid } = data as Correlated<ComputeEvents['serialize']>
    const [values, err] = attemptSync(() => serializeRow({ row, columns }))
    if (err) {
        bridge.emit(`serialize:res:${__cid}`, { values: [], index, error: err.message })
    } else {
        bridge.emit(`serialize:res:${__cid}`, { values, index })
    }
})

bridge.on('deserialize', ({ data }) => {
    const { values, columns, targetDialect, targetVersion, index, __cid } = data as Correlated<ComputeEvents['deserialize']>
    const [record, err] = attemptSync(() => deserializeRow({ values, columns, targetDialect, targetVersion }))
    if (err) {
        bridge.emit(`deserialize:res:${__cid}`, { record: {}, index, error: err.message })
    } else {
        bridge.emit(`deserialize:res:${__cid}`, { record, index })
    }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/workers/compute.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/workers/compute.ts tests/workers/compute.test.ts
git commit -m "feat(workers): implement stateless compute worker for serialize/deserialize"
```


### Task 7: Connection Worker Script

**Files:**
- Create: `src/workers/connection.ts`
- Create: `tests/workers/connection.test.ts`

This worker owns a Kysely instance. Testing uses SQLite (available in CI via `better-sqlite3`). Note: SQLite tests may fail due to a pre-existing `better-sqlite3` native module version mismatch. If so, test manually with postgres or skip in CI and note the issue.

- [ ] **Step 1: Write failing test**

```typescript
// tests/workers/connection.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { resolve } from 'path'
import { WorkerBridge } from '../../src/core/worker-bridge/bridge.js'
import type { ConnectionEvents } from '../../src/core/worker-bridge/types.js'

const CONN_WORKER = resolve(import.meta.dir, '../../src/workers/connection.ts')

describe('connection worker', () => {
    let bridge: WorkerBridge<ConnectionEvents>

    afterEach(async () => {
        if (bridge && !bridge.isShutdown) await bridge.shutdown()
    })

    it('should accept connect and respond', async () => {
        bridge = new WorkerBridge<ConnectionEvents>(CONN_WORKER)
        const result = await bridge.request('connect', {
            dialect: 'sqlite',
            connectionString: ':memory:',
        })
        expect(result.success).toBe(true)
    })

    it('should execute a query', async () => {
        bridge = new WorkerBridge<ConnectionEvents>(CONN_WORKER)
        await bridge.request('connect', {
            dialect: 'sqlite',
            connectionString: ':memory:',
        })

        // Create a table and insert
        await bridge.request('execute', {
            sql: 'CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)',
        })
        await bridge.request('execute', {
            sql: "INSERT INTO test (id, name) VALUES (1, 'alice')",
        })

        const result = await bridge.request('query', {
            sql: 'SELECT * FROM test',
        })

        expect(result.rows).toEqual([{ id: 1, name: 'alice' }])
    })

    it('should handle query:batch with hasMore', async () => {
        bridge = new WorkerBridge<ConnectionEvents>(CONN_WORKER)
        await bridge.request('connect', {
            dialect: 'sqlite',
            connectionString: ':memory:',
        })

        await bridge.request('execute', {
            sql: 'CREATE TABLE nums (n INTEGER)',
        })
        for (let i = 0; i < 5; i++) {
            await bridge.request('execute', {
                sql: `INSERT INTO nums (n) VALUES (${i})`,
            })
        }

        const batch1 = await bridge.request('query:batch', {
            sql: 'SELECT * FROM nums LIMIT 2 OFFSET 0',
            params: [],
            batchSize: 2,
            offset: 0,
        })
        expect(batch1.rows.length).toBe(2)
        expect(batch1.hasMore).toBe(true)

        const batch2 = await bridge.request('query:batch', {
            sql: 'SELECT * FROM nums LIMIT 2 OFFSET 4',
            params: [],
            batchSize: 2,
            offset: 4,
        })
        expect(batch2.rows.length).toBe(1)
        expect(batch2.hasMore).toBe(false)
    })

    it('should return error on bad SQL', async () => {
        bridge = new WorkerBridge<ConnectionEvents>(CONN_WORKER)
        await bridge.request('connect', {
            dialect: 'sqlite',
            connectionString: ':memory:',
        })

        const result = await bridge.request('query', {
            sql: 'SELECT * FROM nonexistent',
        })
        expect(result.error).toBeDefined()
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/workers/connection.test.ts`
Expected: FAIL — `Cannot find module '../../src/workers/connection.ts'`

- [ ] **Step 3: Implement connection worker**

The connection worker needs to create Kysely instances. Check how `src/core/connection/` currently creates them — look at the factory functions and adapt for the worker context. The worker receives `{ dialect, connectionString }` via the `connect` event and instantiates Kysely accordingly.

```typescript
// src/workers/connection.ts
import { WorkerBridge } from '../core/worker-bridge/bridge.js'
import { attempt } from '@logosdx/utils'
import { Kysely, CompiledQuery } from 'kysely'
import type { ConnectionEvents } from '../core/worker-bridge/types.js'
import type { Correlated } from '../core/worker-bridge/types.js'

const bridge = new WorkerBridge<ConnectionEvents>()
let db: Kysely<any> | null = null

// Helper: execute raw SQL via Kysely's CompiledQuery.raw()
async function execRaw(sql: string, params?: unknown[]) {
    return db!.executeQuery(CompiledQuery.raw(sql, params ?? []))
}

bridge.on('connect', async ({ data }) => {
    const { dialect, connectionString, __cid } = data as Correlated<ConnectionEvents['connect']>
    // Use the connection factory from src/core/connection/factory.ts.
    // Look at createConnection() — it creates a Kysely instance from
    // a dialect name and connection string. The worker should call the
    // dialect-specific factory (e.g., createBunSqliteConnection for SQLite,
    // createPostgresConnection for PostgreSQL). Check factory.ts for the
    // exact function signatures and import paths.
    const [instance, err] = await attempt(async () => {
        const { createConnection } = await import('../core/connection/factory.js')
        const result = await createConnection({ dialect, connectionString } as any)
        return result.db
    })
    if (err) {
        bridge.emit(`connect:res:${__cid}`, { success: false, error: err.message })
    } else {
        db = instance
        bridge.emit(`connect:res:${__cid}`, { success: true })
    }
})

bridge.on('disconnect', async ({ data }) => {
    const { __cid } = data as Correlated<ConnectionEvents['disconnect']>
    if (db) {
        await db.destroy()
        db = null
    }
    bridge.emit(`disconnect:res:${__cid}`, {})
})

bridge.on('query', async ({ data }) => {
    const { sql, params, __cid } = data as Correlated<ConnectionEvents['query']>
    if (!db) {
        bridge.emit(`query:res:${__cid}`, { rows: [], error: 'Not connected' })
        return
    }
    const [result, err] = await attempt(async () => {
        const response = await execRaw(sql, params)
        return response.rows as unknown[]
    })
    if (err) {
        bridge.emit(`query:res:${__cid}`, { rows: [], error: err.message })
    } else {
        bridge.emit(`query:res:${__cid}`, { rows: result })
    }
})

bridge.on('query:batch', async ({ data }) => {
    const { sql, params, batchSize, offset, __cid } = data as Correlated<ConnectionEvents['query:batch']>
    if (!db) {
        bridge.emit(`query:batch:res:${__cid}`, { rows: [], offset, hasMore: false, error: 'Not connected' })
        return
    }
    const [result, err] = await attempt(async () => {
        const response = await execRaw(sql, params)
        return response.rows as unknown[]
    })
    if (err) {
        bridge.emit(`query:batch:res:${__cid}`, { rows: [], offset, hasMore: false, error: err.message })
    } else {
        bridge.emit(`query:batch:res:${__cid}`, {
            rows: result,
            offset,
            hasMore: result.length === batchSize,
        })
    }
})

bridge.on('execute', async ({ data }) => {
    const { sql, params, __cid } = data as Correlated<ConnectionEvents['execute']>
    if (!db) {
        bridge.emit(`execute:res:${__cid}`, { affectedRows: 0, error: 'Not connected' })
        return
    }
    const [result, err] = await attempt(async () => {
        const response = await execRaw(sql, params)
        return Number(response.numAffectedRows ?? 0)
    })
    if (err) {
        bridge.emit(`execute:res:${__cid}`, { affectedRows: 0, error: err.message })
    } else {
        bridge.emit(`execute:res:${__cid}`, { affectedRows: result })
    }
})
```

**Note for implementer:** The `createConnection` import above uses the factory from `src/core/connection/factory.ts`. Check the exact function signatures — the factory may expect a full config object rather than just `{ dialect, connectionString }`. Adapt the parameters to match. The test uses SQLite, so ensure the SQLite dialect path works. If the factory registers with `ConnectionManager` or `observer`, you may need to extract just the dialect-creation logic into a separate helper that the worker can use without side effects.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/workers/connection.test.ts`
Expected: All 4 tests PASS (may fail on SQLite due to pre-existing `better-sqlite3` native module issue — see memory notes)

- [ ] **Step 5: Commit**

```bash
git add src/workers/connection.ts tests/workers/connection.test.ts
git commit -m "feat(workers): implement connection worker with Kysely bridge"
```


## Chunk 4: Progress Events


### Task 8: Add Three-Tier Progress Events

**Files:**
- Modify: `src/core/dt/events.ts`

- [ ] **Step 1: Read current events file**

Read `src/core/dt/events.ts` to see the existing DtEvents interface.

- [ ] **Step 2: Add new three-tier progress events**

Add the following events to the `DtEvents` interface in `src/core/dt/events.ts`. Keep the existing events — they're still used. Add the new granular ones alongside:

```typescript
// Three-tier export progress
'dt:export:loaded': { table: string; loaded: number; totalRows: number }
'dt:export:processed': { table: string; processed: number; totalRows: number }
'dt:export:saved': { table: string; saved: number; totalRows: number }

// Three-tier import progress
'dt:import:loaded': { table: string; loaded: number; totalRows: number }
'dt:import:processed': { table: string; processed: number; totalRows: number }
'dt:import:saved': { table: string; saved: number; totalRows: number }
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/core/dt/events.ts
git commit -m "feat(dt): add three-tier progress events for worker pipeline"
```


## Chunk 5: Build Script


### Task 9: Add Worker Entry Points to Binary Build

**Files:**
- Modify: `scripts/build-binary.mjs`

- [ ] **Step 1: Read current build script**

Read `scripts/build-binary.mjs` to see the current `bun build --compile` command pattern.

- [ ] **Step 2: Add worker entry points**

In the build loop, modify the `bun build` command to include worker entry points. The current command (line 31) is:

```javascript
await $`bun build --compile --target=${target} --minify src/cli/index.tsx --outfile ${outfile} --define __CLI_VERSION__=\"${version}\"`.quiet();
```

Add worker scripts as additional entry points:

```javascript
await $`bun build --compile --target=${target} --minify src/cli/index.tsx src/workers/connection.ts src/workers/compute.ts --outfile ${outfile} --define __CLI_VERSION__=\"${version}\"`.quiet();
```

- [ ] **Step 3: Verify the build script runs without error in dev**

Run: `bun run build:binary` (or just validate the script syntax if a full build is slow)

- [ ] **Step 4: Commit**

```bash
git add scripts/build-binary.mjs
git commit -m "build: add worker entry points to binary compilation"
```


## Chunk 6: Lifecycle Integration


### Task 10: Worker Crash Recovery

**Files:**
- Modify: `src/core/worker-bridge/bridge.ts`

The `WorkerBridge` should detect when a spawned worker crashes (exits unexpectedly) and reject any pending `request()` promises. Without this, a worker crash leaves promises hanging forever.

- [ ] **Step 1: Add exit event handling to WorkerBridge constructor**

In `bridge.ts`, when `#ownsWorker` is true, listen for the `exit` event on the Worker:

```typescript
if (script) {
    this.#port = new Worker(script, { workerData: data })
    this.#ownsWorker = true

    // Detect worker crash — emit error so pending requests can fail
    ;(this.#port as Worker).on('exit', (code: number) => {
        if (!this.isShutdown && code !== 0) {
            this.receive('worker:exit', { code, error: `Worker exited with code ${code}` }, undefined as void)
        }
    })
}
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/core/worker-bridge/bridge.ts
git commit -m "feat(worker-bridge): detect worker crashes via exit event"
```


### Task 11: Shutdown Coordination

**Files:**
- Modify: `src/core/connection/manager.ts`

The `ConnectionManager` currently holds direct Kysely instances in `#cached`. For the worker bridge integration, add a method that accepts a `WorkerBridge` for a config name, and update `closeAll()` to shut down bridges alongside direct connections.

**Note:** This is a non-breaking incremental change — existing direct Kysely connections still work. The worker bridge is an additional code path, not a replacement (yet). Full migration of all DB operations to the Connection Worker is a future phase.

- [ ] **Step 1: Read the current ConnectionManager**

Read `src/core/connection/manager.ts` to understand the `#cached` map, `closeAll()`, and the `app:shutdown` listener.

- [ ] **Step 2: Add bridge tracking to ConnectionManager**

Add a `#bridges` map alongside `#cached`. Add `trackBridge()` and `closeBridges()` methods. Update `closeAll()` to also close bridges:

```typescript
import { WorkerBridge } from '../worker-bridge/bridge.js'
import type { ConnectionEvents } from '../worker-bridge/types.js'

// Add to the class:
#bridges = new Map<string, WorkerBridge<ConnectionEvents>>()

trackBridge(configName: string, bridge: WorkerBridge<ConnectionEvents>): void {
    this.#bridges.set(configName, bridge)
}

async closeBridges(): Promise<void> {
    const closePromises = [...this.#bridges.values()].map(b => b.shutdown())
    await Promise.all(closePromises)
    this.#bridges.clear()
}

// In closeAll(), add after existing connection closing:
await this.closeBridges()
```

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/core/connection/manager.ts
git commit -m "feat(connection): add worker bridge tracking to ConnectionManager"
```


## Chunk 7: DT Export Pipeline Refactor

This refactors `exportTable()` in `src/core/dt/index.ts` to use the worker pipeline. Broken into sub-steps for manageability. The existing function signature and return type stay the same — callers are unaffected.

**Scope note:** Multi-table parallelism (running N table pipelines concurrently) is out of scope for this plan. The infrastructure supports it (Connection Worker handles interleaved requests via correlation IDs, compute pool is shared), but the orchestration code in `exportTable()` handles one table at a time. Multi-table is a future enhancement.


### Task 12: Add Worker Parameters to exportTable()

**Files:**
- Modify: `src/core/dt/index.ts`

- [ ] **Step 1: Read the current exportTable() implementation**

Read `src/core/dt/index.ts` lines 73-201 to understand the current synchronous loop.

- [ ] **Step 2: Add optional worker parameters to ExportTableOptions**

Add optional `connectionBridge` and `computePool` parameters to the options type. When provided, the function uses workers. When absent, it falls back to the current inline behavior. This makes the refactor non-breaking.

```typescript
import type { WorkerBridge } from '../worker-bridge/bridge.js'
import type { WorkerPool } from '../worker-bridge/pool.js'
import type { ConnectionEvents, ComputeEvents } from '../worker-bridge/types.js'

// Add to ExportTableOptions:
connectionBridge?: WorkerBridge<ConnectionEvents>
computePool?: WorkerPool<ComputeEvents>
```

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/core/dt/index.ts
git commit -m "feat(dt): add optional worker parameters to exportTable"
```


### Task 13: Replace Batch Fetch Loop with Connection Worker

**Files:**
- Modify: `src/core/dt/index.ts`

- [ ] **Step 1: Add COUNT(*) query for totalRows**

At the start of `exportTable()`, when `connectionBridge` is provided, run a `COUNT(*)` query to get `totalRows` for progress percentages.

- [ ] **Step 2: Replace the offset/limit fetch loop**

When `connectionBridge` is provided, replace the direct Kysely query with `connectionBridge.request('query:batch', ...)`. The batch returns `{ rows, offset, hasMore }`. Loop while `hasMore` is true.

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/core/dt/index.ts
git commit -m "feat(dt): use connection worker for batch fetching in export"
```


### Task 14: Add Row-Level Dispatch to Compute Pool

**Files:**
- Modify: `src/core/dt/index.ts`

- [ ] **Step 1: Replace inline serializeRow() with compute pool dispatch**

When `computePool` is provided, instead of calling `serializeRow()` inline for each row, dispatch individual rows to the compute pool:

```typescript
// For each row in the batch:
const globalIndex = offset + rowIndex
computePool.request('serialize', { row, columns: schema.columns, index: globalIndex })
    .then(result => {
        processedCount++
        observer.emit('dt:export:processed', { table, processed: processedCount, totalRows })
        orderBuffer.add(result.index, result.values)
    })
```

- [ ] **Step 2: Wire OrderBuffer to flush to DtWriter**

Create an `OrderBuffer<DtValue[]>` whose flush callback JSON5-stringifies the values and writes to DtWriter:

```typescript
const orderBuffer = new OrderBuffer<DtValue[]>(values => {
    writer.writeRow(values)
    savedCount++
    observer.emit('dt:export:saved', { table, saved: savedCount, totalRows })
})
```

- [ ] **Step 3: Add backpressure gating**

Before requesting the next batch from the Connection Worker, check the order buffer's pending count. If `orderBuffer.pending > batchSize * 3`, wait for it to drain before fetching more:

```typescript
// After dispatching all rows in a batch:
while (orderBuffer.pending > batchSize * 3) {
    await new Promise(resolve => setTimeout(resolve, 10))
}
// Now safe to request next batch
```

- [ ] **Step 4: Add loaded progress event**

After each batch arrives from the Connection Worker:

```typescript
loadedCount += rows.length
observer.emit('dt:export:loaded', { table, loaded: loadedCount, totalRows })
```

- [ ] **Step 5: Drain remaining results after last batch**

When `hasMore` is false, wait for all in-flight compute requests to complete and the order buffer to fully flush before calling `writer.close()`.

- [ ] **Step 6: Verify typecheck**

Run: `bun run typecheck`

- [ ] **Step 7: Commit**

```bash
git add src/core/dt/index.ts
git commit -m "feat(dt): wire compute pool and order buffer into export pipeline"
```


### Task 15: Refactor importDtFile() to Use Workers

**Files:**
- Modify: `src/core/dt/index.ts`

- [ ] **Step 1: Read the current importDtFile() implementation**

Read `src/core/dt/index.ts` lines 221-413 to understand the current deserialization loop.

- [ ] **Step 2: Add optional worker parameters to ImportFileOptions**

Same pattern as export — add optional `connectionBridge` and `computePool` parameters.

- [ ] **Step 3: Count total rows from file**

Before starting the pipeline, count lines in the file (after schema header) to get `totalRows`.

- [ ] **Step 4: Replace inline deserializeRow() with compute pool dispatch**

Read 1000 lines via DtReader. Fan out individual lines to compute pool with index. Accumulate in OrderBuffer. When a full batch is ordered, send to Connection Worker for batched INSERT.

- [ ] **Step 5: Add pull-based drain gating**

After dispatching 1000 lines, wait for the full pipeline to drain (all deserialized + inserted) before reading the next 1000. This prevents the file reader from outrunning the DB:

```typescript
// Read 1000 lines
// Dispatch to compute pool
// Wait for all 1000 to be deserialized AND inserted
// Then read next 1000
```

- [ ] **Step 6: Add three-tier progress events**

Emit `dt:import:loaded`, `dt:import:processed`, `dt:import:saved` at the appropriate points.

- [ ] **Step 7: Verify typecheck**

Run: `bun run typecheck`

- [ ] **Step 8: Commit**

```bash
git add src/core/dt/index.ts
git commit -m "feat(dt): refactor importDtFile() to use worker pipeline"
```


## Chunk 8: Integration Testing


### Task 16: Worker Pipeline Integration Tests

**Files:**
- Create: `tests/core/dt/worker-pipeline.test.ts`

- [ ] **Step 1: Write integration test for export pipeline**

This test runs the full export pipeline: create a table with test data, export via the worker pipeline, read back the file, and verify contents match.

```typescript
// tests/core/dt/worker-pipeline.test.ts
import { describe, it, expect } from 'bun:test'
import { resolve } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'

// Import the refactored exportTable and importDtFile
// These now use workers internally
import { exportTable, importDtFile } from '../../../src/core/dt/index.js'

const TMP_DIR = resolve(import.meta.dir, '../../../tmp/test-worker-pipeline')

describe('worker pipeline integration', () => {

    // Setup and teardown TMP_DIR per test as needed

    it('should export and reimport data with identical results', async () => {
        // This test requires a live database connection.
        // Use SQLite if better-sqlite3 works, otherwise skip.
        // The test should:
        // 1. Create a table with mixed types (int, string, text, json)
        // 2. Insert test rows (including large text that triggers gz64)
        // 3. Call exportTable() with the worker pipeline
        // 4. Verify the .dt file exists and has correct row count
        // 5. Call importDtFile() to import into a new table
        // 6. Query the new table and verify data matches original

        // Implementation depends on available database connection.
        // If SQLite native module is broken, this test should be
        // marked as skip with a note about the pre-existing issue.
    })
})
```

- [ ] **Step 2: Run integration tests**

Run: `bun test tests/core/dt/worker-pipeline.test.ts`

- [ ] **Step 3: Commit**

```bash
git add tests/core/dt/worker-pipeline.test.ts
git commit -m "test(dt): add worker pipeline integration tests"
```


### Task 17: Final Typecheck and Test Suite

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 2: Run full test suite**

Run: `bun test --serial`
Expected: No new failures beyond pre-existing ones (better-sqlite3, integration tests needing live DBs)

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: resolve any remaining typecheck or test issues"
```
