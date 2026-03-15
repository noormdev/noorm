import { describe, it, expect, afterEach } from 'bun:test';
import { resolve } from 'path';

import { WorkerBridge } from '../../src/core/worker-bridge/bridge.js';
import type { ComputeEvents } from '../../src/core/worker-bridge/types.js';

const COMPUTE_WORKER = resolve(import.meta.dir, '../../src/workers/compute.ts');

describe('workers: compute', () => {

    let bridge: WorkerBridge<ComputeEvents>;

    afterEach(async () => {

        if (bridge && !bridge.isShutdown) await bridge.shutdown();

    });

    it('should serialize a simple row', async () => {

        bridge = new WorkerBridge<ComputeEvents>(COMPUTE_WORKER);

        const result = await bridge.request('serialize', {
            row: { id: 1, name: 'alice' },
            columns: [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'string' },
            ],
            index: 0,
        });

        expect(result.values).toEqual([1, 'alice']);
        expect(result.index).toBe(0);
        expect(result.error).toBeUndefined();

    });

    it('should deserialize a simple row', async () => {

        bridge = new WorkerBridge<ComputeEvents>(COMPUTE_WORKER);

        const result = await bridge.request('deserialize', {
            values: [1, 'alice'],
            columns: [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'string' },
            ],
            targetDialect: 'postgres',
            index: 0,
        });

        expect(result.record).toEqual({ id: 1, name: 'alice' });
        expect(result.index).toBe(0);
        expect(result.error).toBeUndefined();

    });

    it('should preserve index through the pipeline', async () => {

        bridge = new WorkerBridge<ComputeEvents>(COMPUTE_WORKER);

        const result = await bridge.request('serialize', {
            row: { id: 42 },
            columns: [{ name: 'id', type: 'int' }],
            index: 999,
        });

        expect(result.index).toBe(999);

    });

});
