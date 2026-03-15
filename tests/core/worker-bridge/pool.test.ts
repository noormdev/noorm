import { describe, it, expect, afterEach } from 'bun:test';
import { resolve } from 'path';
import { WorkerPool } from '../../../src/core/worker-bridge/pool.js';

const ADDER_WORKER = resolve(import.meta.dir, '../../fixtures/workers/adder.ts');

interface AdderEvents {
    'add': { a: number; b: number; index: number }
    'add:res': { result: number; index: number }
}

describe('worker-bridge: WorkerPool', () => {

    let pool: WorkerPool<AdderEvents>;

    afterEach(async () => {

        if (pool && !pool.isShutdown) await pool.shutdown();

    });

    it('should create N workers', () => {

        pool = new WorkerPool<AdderEvents>(ADDER_WORKER, { size: 3 });
        expect(pool.size).toBe(3);

    });

    it('should dispatch requests to workers', async () => {

        pool = new WorkerPool<AdderEvents>(ADDER_WORKER, { size: 2 });
        const result = await pool.request('add', { a: 2, b: 3, index: 0 });
        expect(result.result).toBe(5);

    });

    it('should handle concurrent requests across workers', async () => {

        pool = new WorkerPool<AdderEvents>(ADDER_WORKER, { size: 3 });
        const results = await Promise.all([
            pool.request('add', { a: 1, b: 1, index: 0 }),
            pool.request('add', { a: 2, b: 2, index: 1 }),
            pool.request('add', { a: 3, b: 3, index: 2 }),
        ]);
        expect(results.map(r => r.result)).toEqual([2, 4, 6]);

    });

    it('should shutdown all workers', async () => {

        pool = new WorkerPool<AdderEvents>(ADDER_WORKER, { size: 3 });
        await pool.shutdown();
        expect(pool.isShutdown).toBe(true);

    });

    it('should floor size to 1', () => {

        pool = new WorkerPool<AdderEvents>(ADDER_WORKER, { size: 0 });
        expect(pool.size).toBe(1);

    });

});
