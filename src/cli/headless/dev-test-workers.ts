/**
 * Dev command: test worker thread infrastructure.
 *
 * Runs a series of diagnostics to verify WorkerBridge, WorkerPool,
 * and worker scripts function correctly in the current execution
 * context (dev mode, dist/, compiled binary).
 *
 * @example
 * ```bash
 * noorm -H dev test-workers
 * noorm-darwin-arm64 dev test-workers
 * ```
 */

import { attempt } from '@logosdx/utils';

import { WorkerBridge } from '../../core/worker-bridge/bridge.js';
import { OrderBuffer } from '../../core/worker-bridge/order-buffer.js';
import { resolveWorker } from '../../core/worker-bridge/paths.js';
import type { ComputeEvents, ConnectionEvents } from '../../core/worker-bridge/types.js';
import type { Logger } from '../../core/logger/index.js';
import type { RouteParams, CliFlags } from '../types.js';

export const help = `
# dev test-workers

Internal diagnostic — tests worker thread infrastructure.

## Usage

    noorm -H dev test-workers

## Tests

    1. Path resolution    Verifies resolveWorker() returns valid paths
    2. Compute spawn      Spawns a compute worker and sends a serialize request
    3. Pool dispatch      Creates a 2-worker pool and dispatches concurrent requests
    4. OrderBuffer        Feeds out-of-order results, verifies ordered flush
    5. Connection spawn   Spawns a connection worker and connects to SQLite :memory:
`;

interface TestResult {
    name: string;
    status: 'PASS' | 'FAIL';
    detail?: string;
    error?: string;
    durationMs: number;
}

async function runTest(
    name: string,
    fn: () => Promise<string>,
): Promise<TestResult> {

    const start = performance.now();
    const [detail, err] = await attempt(fn);
    const durationMs = Math.round(performance.now() - start);

    if (err) {

        return { name, status: 'FAIL', error: err.message, durationMs };

    }

    return { name, status: 'PASS', detail: detail ?? undefined, durationMs };

}

export async function run(
    _params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    const results: TestResult[] = [];

    // --- Test 1: Path resolution ---
    results.push(await runTest('Path resolution', async () => {

        const computePath = resolveWorker('compute');
        const connectionPath = resolveWorker('connection');

        return `compute=${computePath}  connection=${connectionPath}`;

    }));

    // --- Test 2: Compute worker spawn ---
    results.push(await runTest('Compute spawn', async () => {

        const computePath = resolveWorker('compute');
        const bridge = new WorkerBridge<ComputeEvents>(computePath);

        const result = await bridge.request('serialize', {
            row: { id: 1, name: 'test' },
            columns: [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'string' },
            ],
            index: 0,
        });

        await bridge.shutdown();

        if (result.error) throw new Error(result.error);
        const match = JSON.stringify(result.values) === JSON.stringify([1, 'test']);

        return match
            ? `values=[1,"test"] index=${result.index}`
            : `MISMATCH: got ${JSON.stringify(result.values)}`;

    }));

    // --- Test 3: Pool dispatch ---
    results.push(await runTest('Pool dispatch (2 workers)', async () => {

        const pool = WorkerBridge.pool<ComputeEvents>(resolveWorker('compute'), { size: 2 });

        const promises = Array.from({ length: 5 }, (_, i) =>
            pool.request('serialize', {
                row: { n: i },
                columns: [{ name: 'n', type: 'int' }],
                index: i,
            }),
        );

        const results = await Promise.all(promises);
        await pool.shutdown();

        const allCorrect = results.every((r, i) =>
            r.index === i && JSON.stringify(r.values) === JSON.stringify([i]),
        );

        return allCorrect
            ? '5/5 dispatched and returned correctly'
            : 'MISMATCH in results';

    }));

    // --- Test 4: OrderBuffer ---
    results.push(await runTest('OrderBuffer (out-of-order)', async () => {

        const flushed: number[] = [];
        const buffer = new OrderBuffer<number>(item => {

            flushed.push(item);

        });

        // Feed out of order
        buffer.add(3, 30);
        buffer.add(1, 10);
        buffer.add(4, 40);
        buffer.add(0, 0);
        buffer.add(2, 20);

        const correct = JSON.stringify(flushed) === JSON.stringify([0, 10, 20, 30, 40]);

        return correct
            ? '5 items flushed in order: [0,10,20,30,40]'
            : `WRONG ORDER: ${JSON.stringify(flushed)}`;

    }));

    // --- Test 5: Connection worker spawn ---
    results.push(await runTest('Connection spawn (SQLite :memory:)', async () => {

        const bridge = new WorkerBridge<ConnectionEvents>(resolveWorker('connection'));

        const connectResult = await bridge.request('connect', {
            dialect: 'sqlite',
            connectionString: ':memory:',
        });

        if (connectResult.error) {

            await bridge.shutdown();
            throw new Error(connectResult.error);

        }

        // Create table, insert, query
        await bridge.request('execute', {
            sql: 'CREATE TABLE test_workers (id INTEGER PRIMARY KEY, val TEXT)',
        });
        await bridge.request('execute', {
            sql: "INSERT INTO test_workers (id, val) VALUES (1, 'hello')",
        });

        const queryResult = await bridge.request('query', {
            sql: 'SELECT * FROM test_workers',
        });

        await bridge.request('disconnect', {});
        await bridge.shutdown();

        if (queryResult.error) throw new Error(queryResult.error);

        const row = queryResult.rows[0] as Record<string, unknown>;

        return row?.['id'] === 1 && row?.['val'] === 'hello'
            ? 'query returned {id:1, val:"hello"}'
            : `UNEXPECTED: ${JSON.stringify(queryResult.rows)}`;

    }));

    // --- Output ---

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;

    if (flags.json) {

        logger.result({ tests: results, passed, failed, total: results.length });

    }
    else {

        logger.info('');
        logger.info('Worker Thread Diagnostics');
        logger.info('─'.repeat(60));

        for (const r of results) {

            const icon = r.status === 'PASS' ? '✓' : '✗';
            const ms = `${r.durationMs}ms`.padStart(6);
            logger.info(`  ${icon}  ${r.name.padEnd(35)} ${ms}`);

            if (r.detail) {

                logger.info(`     ${r.detail}`);

            }

            if (r.error) {

                logger.error(`     ${r.error}`);

            }

        }

        logger.info('─'.repeat(60));
        logger.info(`  ${passed} passed, ${failed} failed`);
        logger.info('');

    }

    return failed > 0 ? 1 : 0;

}
