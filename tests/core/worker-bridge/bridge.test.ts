import { describe, it, expect, afterEach } from 'bun:test';
import { resolve } from 'path';
import { attempt } from '@logosdx/utils';
import { WorkerBridge } from '../../../src/core/worker-bridge/bridge.js';

const ECHO_WORKER = resolve(import.meta.dir, '../../fixtures/workers/echo.ts');
const DYING_WORKER = resolve(import.meta.dir, '../../fixtures/workers/dying.ts');
const SILENT_WORKER = resolve(import.meta.dir, '../../fixtures/workers/silent.ts');

interface EchoEvents {
    'ping': { message: string }
    'ping:res': { message: string }
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

    // A dead worker never posts a response. Without a rejection path the
    // caller's await never settles, which is what wedged the .dt pipelines
    // forever on a single crashed compute thread.
    it('should reject an in-flight request when the worker dies', async () => {

        bridge = new WorkerBridge<EchoEvents>(DYING_WORKER);

        const [result, err] = await attempt(() => bridge.request('ping', { message: 'hello' }));

        expect(result).toBeNull();
        expect(err).toBeInstanceOf(Error);
        expect(err!.message).toMatch(/exited with code 7/);

    });

    it('should reject new requests made after the worker died', async () => {

        bridge = new WorkerBridge<EchoEvents>(DYING_WORKER);

        await attempt(() => bridge.request('ping', { message: 'first' }));

        const [result, err] = await attempt(() => bridge.request('ping', { message: 'second' }));

        expect(result).toBeNull();
        expect(err).toBeInstanceOf(Error);
        expect(err!.message).toMatch(/exited with code 7/);

    });

    it('should reject in-flight requests on shutdown', async () => {

        bridge = new WorkerBridge<EchoEvents>(SILENT_WORKER);

        const pending = attempt(() => bridge.request('ping', { message: 'x' }));

        await bridge.shutdown();

        const [result, err] = await pending;

        expect(result).toBeNull();
        expect(err).toBeInstanceOf(Error);

    });

});
