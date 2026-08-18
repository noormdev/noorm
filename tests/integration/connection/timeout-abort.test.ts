/**
 * Connect timeout and escape-hatch integration tests.
 *
 * Two claims that only a real socket can settle: an unreachable host now ends
 * the attempt on its own instead of waiting forever, and a caller who stops
 * waiting gets control back in a fraction of that time without leaving an open
 * pool behind.
 */
import { describe, it, expect } from 'bun:test';
import { attempt } from '@logosdx/utils';

import {
    createConnection,
    testConnection,
    getConnectionManager,
} from '../../../src/core/connection/index.js';
import { OperationAbortedError } from '../../../src/core/shared/abort.js';
import { TEST_CONNECTIONS, skipIfNoContainer } from '../../utils/db.js';
import type { ConnectionConfig } from '../../../src/core/connection/types.js';

/**
 * RFC 5737 TEST-NET-1, reserved for documentation and guaranteed never to be
 * routed. Packets to it are dropped rather than refused, which is what
 * reproduces "the screen gets stuck" — a connect with nothing to fail on.
 */
const BLACKHOLE_HOST = '192.0.2.1';

/** Short enough to keep the suite quick, long enough to outlast the abort. */
const SHORT_TIMEOUT_MS = 1_500;

function blackholeConfig(dialect: ConnectionConfig['dialect']): ConnectionConfig {

    return {
        dialect,
        host: BLACKHOLE_HOST,
        port: dialect === 'mysql' ? 3306 : 5432,
        user: 'nobody',
        password: 'nobody',
        database: 'nothing',
        connectTimeoutMs: SHORT_TIMEOUT_MS,
    };

}

describe('integration: unreachable host', () => {

    it('should give up on its own rather than waiting forever', async () => {

        const started = Date.now();

        const [conn, err] = await attempt(() =>
            createConnection(blackholeConfig('postgres'), '__blackhole__', { retries: 1, delay: 0 }),
        );

        const elapsed = Date.now() - started;

        expect(conn).toBeNull();
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(OperationAbortedError);
        expect(elapsed).toBeLessThan(SHORT_TIMEOUT_MS * 4);

        // The driver's own message, not the generic wrapper's. The two
        // deadlines race, and the driver has to win it: only its timeout tears
        // the socket down, and only it can name what actually failed.
        expect(err?.message).toContain('connection timeout');

    }, 30_000);

    it('should come back far sooner than the timeout when the caller stops waiting', async () => {

        const controller = new AbortController();
        const started = Date.now();

        const pending = attempt(() =>
            createConnection(
                blackholeConfig('postgres'),
                '__blackhole__',
                { retries: 1, delay: 0 },
                controller.signal,
            ),
        );

        setTimeout(() => controller.abort(), 100);

        const [conn, err] = await pending;
        const elapsed = Date.now() - started;

        expect(conn).toBeNull();
        expect(err).toBeInstanceOf(OperationAbortedError);
        expect(elapsed).toBeLessThan(SHORT_TIMEOUT_MS);

    }, 30_000);

    it('should report an aborted testConnection as aborted, not as a database failure', async () => {

        const controller = new AbortController();

        const pending = testConnection(blackholeConfig('postgres'), { signal: controller.signal });

        setTimeout(() => controller.abort(), 100);

        const result = await pending;

        expect(result.ok).toBe(false);
        expect(result.aborted).toBe(true);

    }, 30_000);

});

describe('integration: abandoned connection cleanup', () => {

    it('should close a connection that finishes opening after the caller gave up', async () => {

        await skipIfNoContainer('postgres');

        const manager = getConnectionManager();
        const baseline = manager.size;

        const controller = new AbortController();

        const pending = attempt(() =>
            createConnection(TEST_CONNECTIONS.postgres, '__abandoned__', {}, controller.signal),
        );

        // The connect has not had a tick to complete yet, so the abort wins the
        // race and the pool that opens a moment later has no owner at all.
        controller.abort();

        const [conn, err] = await pending;

        expect(conn).toBeNull();
        expect(err).toBeInstanceOf(OperationAbortedError);

        // The salvage path untracks as it destroys, so the manager returning to
        // its baseline is the proof the abandoned pool was actually closed
        // rather than merely forgotten.
        const deadline = Date.now() + 10_000;

        while (manager.size > baseline && Date.now() < deadline) {

            await new Promise((r) => setTimeout(r, 50));

        }

        expect(manager.size).toBe(baseline);

    }, 30_000);

});
