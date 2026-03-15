import { describe, it, expect, afterEach } from 'bun:test';
import { resolve } from 'path';
import { WorkerBridge } from '../../../src/core/worker-bridge/bridge.js';

const ECHO_WORKER = resolve(import.meta.dir, '../../fixtures/workers/echo.ts');

interface EchoEvents {
    'ping': { message: string }
    'ping:res': { message: string }
    'init': Record<string, unknown>
}

describe('worker-bridge: WorkerBridge', () => {

    let bridge: WorkerBridge<EchoEvents>;

    afterEach(async () => {

        if (bridge && !bridge.isShutdown) await bridge.shutdown();

    });

    it('should spawn a worker in parent mode', () => {

        bridge = new WorkerBridge<EchoEvents>(ECHO_WORKER);
        expect(bridge).toBeDefined();
        expect(bridge.isShutdown).toBe(false);

    });

    it('should send and receive messages via request()', async () => {

        bridge = new WorkerBridge<EchoEvents>(ECHO_WORKER);
        const result = await bridge.request('ping', { message: 'hello' });
        expect(result.message).toBe('hello');

    });

    it('should forward workerData to the worker', async () => {

        bridge = new WorkerBridge<EchoEvents>(ECHO_WORKER, { greeting: 'hi' });
        const { data } = await bridge.once('init');
        expect(data.greeting).toBe('hi');

    });

    it('should shut down cleanly', async () => {

        bridge = new WorkerBridge<EchoEvents>(ECHO_WORKER);
        await bridge.shutdown();
        expect(bridge.isShutdown).toBe(true);

    });

    it('should throw when no script and not in worker', () => {

        expect(() => new WorkerBridge<EchoEvents>()).toThrow(
            'WorkerBridge: no script provided and not in a worker thread',
        );

    });

});
