/**
 * Worker pipeline integration tests.
 *
 * Verifies the end-to-end compute pool + OrderBuffer pipeline and
 * the connection worker's SQLite in-memory operations without relying
 * on better-sqlite3 (which has a native module version mismatch in CI).
 * The connection worker uses bun:sqlite via createBunSqliteConnection.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { resolve } from 'path';
import { WorkerBridge } from '../../../src/core/worker-bridge/bridge.js';
import { WorkerPool } from '../../../src/core/worker-bridge/pool.js';
import { OrderBuffer } from '../../../src/core/worker-bridge/order-buffer.js';
import type { ComputeEvents, ConnectionEvents } from '../../../src/core/worker-bridge/types.js';

// ---------------------------------------------------------------------------
// Worker paths
// ---------------------------------------------------------------------------

const COMPUTE_WORKER = resolve(import.meta.dir, '../../../src/workers/compute.ts');
const CONNECTION_WORKER = resolve(import.meta.dir, '../../../src/workers/connection.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('dt: worker pipeline integration', () => {

    let pool: WorkerPool<ComputeEvents>;
    let bridge: WorkerBridge<ConnectionEvents>;

    afterEach(async () => {

        if (pool && !pool.isShutdown) await pool.shutdown();
        if (bridge && !bridge.isShutdown) await bridge.shutdown();

    });

    // -----------------------------------------------------------------------
    // Compute pool + OrderBuffer roundtrip
    // -----------------------------------------------------------------------

    it('should serialize multiple rows via pool and reassemble in order', async () => {

        pool = WorkerBridge.pool<ComputeEvents>(COMPUTE_WORKER, { size: 3 });

        const flushed: { values: unknown[]; index: number }[] = [];

        const buffer = new OrderBuffer<{ values: unknown[]; index: number }>(item => {

            flushed.push(item);

        });

        const columns = [
            { name: 'id', type: 'int' as const },
            { name: 'name', type: 'string' as const },
        ];

        // Dispatch 10 rows to 3 workers — they will finish out of order
        const promises = Array.from({ length: 10 }, (_, i) =>
            pool.request('serialize', {
                row: { id: i, name: `user-${i}` },
                columns,
                index: i,
            }).then(result => {

                buffer.add(result.index, { values: result.values, index: result.index });

            }),
        );

        await Promise.all(promises);

        // All 10 should have flushed in order
        expect(flushed.length).toBe(10);

        for (let i = 0; i < 10; i++) {

            expect(flushed[i].index).toBe(i);
            expect(flushed[i].values).toEqual([i, `user-${i}`]);

        }

    });

    // -----------------------------------------------------------------------
    // Encoded types through compute pipeline
    // -----------------------------------------------------------------------

    it('should handle encoded types through the compute pipeline', async () => {

        pool = WorkerBridge.pool<ComputeEvents>(COMPUTE_WORKER, { size: 2 });

        // JSON type produces encoded tuples [value, encoding]
        const result = await pool.request('serialize', {
            row: { data: { key: 'value', nested: { deep: true } } },
            columns: [{ name: 'data', type: 'json' as const }],
            index: 0,
        });

        expect(result.index).toBe(0);
        expect(result.error).toBeUndefined();

        // JSON columns produce encoded tuples
        const encoded = result.values[0] as [unknown, string];
        expect(Array.isArray(encoded)).toBe(true);
        expect(encoded[1]).toBe('raw'); // small JSON uses 'raw' encoding

    });

    // -----------------------------------------------------------------------
    // OrderBuffer stress test
    // -----------------------------------------------------------------------

    it('should flush 100 items out of order in correct sequence', () => {

        const flushed: number[] = [];
        const buffer = new OrderBuffer<number>(item => {

            flushed.push(item);

        });

        // Build a shuffled index list (Fisher-Yates)
        const indices = Array.from({ length: 100 }, (_, i) => i);

        for (let i = indices.length - 1; i > 0; i--) {

            const j = Math.floor(Math.random() * (i + 1));

            [indices[i], indices[j]] = [indices[j]!, indices[i]!];

        }

        for (const idx of indices) {

            buffer.add(idx, idx);

        }

        expect(flushed.length).toBe(100);

        for (let i = 0; i < 100; i++) {

            expect(flushed[i]).toBe(i);

        }

        expect(buffer.pending).toBe(0);

    });

    // -----------------------------------------------------------------------
    // Connection worker — SQLite :memory: via bun:sqlite
    // -----------------------------------------------------------------------

    it('should connect to SQLite :memory: and execute queries', async () => {

        bridge = new WorkerBridge<ConnectionEvents>(CONNECTION_WORKER);

        const connectRes = await bridge.request('connect', {
            dialect: 'sqlite',
            connectionString: ':memory:',
        });

        expect(connectRes.success).toBe(true);
        expect(connectRes.error).toBeUndefined();

    });

    it('should create table and insert rows via connection worker', async () => {

        bridge = new WorkerBridge<ConnectionEvents>(CONNECTION_WORKER);

        await bridge.request('connect', {
            dialect: 'sqlite',
            connectionString: ':memory:',
        });

        const createRes = await bridge.request('execute', {
            sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
            params: [],
        });

        expect(createRes.error).toBeUndefined();

        const insertRes = await bridge.request('execute', {
            sql: 'INSERT INTO users (id, name) VALUES (1, ?), (2, ?), (3, ?)',
            params: ['alice', 'bob', 'carol'],
        });

        expect(insertRes.error).toBeUndefined();
        expect(insertRes.affectedRows).toBe(3);

    });

    it('should query rows and return results', async () => {

        bridge = new WorkerBridge<ConnectionEvents>(CONNECTION_WORKER);

        await bridge.request('connect', { dialect: 'sqlite', connectionString: ':memory:' });

        await bridge.request('execute', {
            sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
            params: [],
        });

        await bridge.request('execute', {
            sql: 'INSERT INTO users (id, name) VALUES (1, ?), (2, ?), (3, ?)',
            params: ['alice', 'bob', 'carol'],
        });

        const queryRes = await bridge.request('query', {
            sql: 'SELECT id, name FROM users ORDER BY id',
            params: [],
        });

        expect(queryRes.error).toBeUndefined();
        expect(queryRes.rows.length).toBe(3);
        expect((queryRes.rows[0] as Record<string, unknown>).name).toBe('alice');
        expect((queryRes.rows[2] as Record<string, unknown>).name).toBe('carol');

    });

    it('should paginate via query:batch with hasMore flag', async () => {

        bridge = new WorkerBridge<ConnectionEvents>(CONNECTION_WORKER);

        await bridge.request('connect', { dialect: 'sqlite', connectionString: ':memory:' });

        await bridge.request('execute', {
            sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY)',
            params: [],
        });

        // Insert 10 rows
        const placeholders = Array.from({ length: 10 }, (_, i) => `(${i + 1})`).join(', ');
        await bridge.request('execute', {
            sql: `INSERT INTO items (id) VALUES ${placeholders}`,
            params: [],
        });

        // First page: offset 0, batchSize 4 → hasMore true
        const page1 = await bridge.request('query:batch', {
            sql: 'SELECT id FROM items ORDER BY id',
            params: [],
            batchSize: 4,
            offset: 0,
        });

        expect(page1.error).toBeUndefined();
        expect(page1.rows.length).toBe(4);
        expect(page1.hasMore).toBe(true);
        expect(page1.offset).toBe(0);

        // Last page: offset 8, batchSize 4 → hasMore false (only 2 rows left)
        const page3 = await bridge.request('query:batch', {
            sql: 'SELECT id FROM items ORDER BY id',
            params: [],
            batchSize: 4,
            offset: 8,
        });

        expect(page3.error).toBeUndefined();
        expect(page3.rows.length).toBe(2);
        expect(page3.hasMore).toBe(false);
        expect(page3.offset).toBe(8);

    });

    it('should return error when querying before connect', async () => {

        bridge = new WorkerBridge<ConnectionEvents>(CONNECTION_WORKER);

        const res = await bridge.request('query', {
            sql: 'SELECT 1',
            params: [],
        });

        expect(res.error).toBe('Not connected');
        expect(res.rows).toEqual([]);

    });

    // -----------------------------------------------------------------------
    // Deserialize roundtrip through compute pool
    // -----------------------------------------------------------------------

    it('should deserialize encoded values back to records', async () => {

        pool = WorkerBridge.pool<ComputeEvents>(COMPUTE_WORKER, { size: 2 });

        // Serialize first
        const serResult = await pool.request('serialize', {
            row: { id: 42, meta: { role: 'admin' } },
            columns: [
                { name: 'id', type: 'int' as const },
                { name: 'meta', type: 'json' as const },
            ],
            index: 0,
        });

        expect(serResult.error).toBeUndefined();

        // Deserialize the serialized values
        const desResult = await pool.request('deserialize', {
            values: serResult.values,
            columns: [
                { name: 'id', type: 'int' as const },
                { name: 'meta', type: 'json' as const },
            ],
            targetDialect: 'sqlite',
            index: 0,
        });

        expect(desResult.error).toBeUndefined();
        expect(desResult.record.id).toBe(42);
        expect(desResult.record.meta).toEqual({ role: 'admin' });

    });

});
