import { describe, it, expect, afterEach } from 'bun:test';
import { resolve } from 'path';
import { WorkerBridge } from '../../src/core/worker-bridge/bridge.js';
import type { ConnectionEvents } from '../../src/core/worker-bridge/types.js';

const CONN_WORKER = resolve(import.meta.dir, '../../src/workers/connection.ts');

describe('workers: connection', () => {

    let bridge: WorkerBridge<ConnectionEvents>;

    afterEach(async () => {

        if (bridge && !bridge.isShutdown) await bridge.shutdown();

    });

    it('should accept connect and respond', async () => {

        bridge = new WorkerBridge<ConnectionEvents>(CONN_WORKER);
        const result = await bridge.request('connect', {
            dialect: 'sqlite',
            connectionString: ':memory:',
        });
        expect(result.success).toBe(true);

    });

    it('should execute a query after connecting', async () => {

        bridge = new WorkerBridge<ConnectionEvents>(CONN_WORKER);
        await bridge.request('connect', {
            dialect: 'sqlite',
            connectionString: ':memory:',
        });

        await bridge.request('execute', {
            sql: 'CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)',
        });
        await bridge.request('execute', {
            sql: "INSERT INTO test (id, name) VALUES (1, 'alice')",
        });

        const result = await bridge.request('query', {
            sql: 'SELECT * FROM test',
        });

        expect(result.rows).toEqual([{ id: 1, name: 'alice' }]);

    });

    it('should return error on bad SQL', async () => {

        bridge = new WorkerBridge<ConnectionEvents>(CONN_WORKER);
        await bridge.request('connect', {
            dialect: 'sqlite',
            connectionString: ':memory:',
        });

        const result = await bridge.request('query', {
            sql: 'SELECT * FROM nonexistent',
        });
        expect(result.error).toBeDefined();

    });

    it('should return error when not connected', async () => {

        bridge = new WorkerBridge<ConnectionEvents>(CONN_WORKER);
        const result = await bridge.request('query', {
            sql: 'SELECT 1',
        });
        expect(result.error).toBe('Not connected');

    });

});
