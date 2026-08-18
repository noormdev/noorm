/**
 * Connect-timeout and cancellation tests for the connection layer.
 *
 * The intent: a hung connect has to end on its own, and a caller who stops
 * waiting has to get control back without abandoning an open pool. Both are
 * invisible in a happy-path test, so they are pinned here explicitly.
 */
import { describe, it, expect } from 'bun:test';
import { attempt } from '@logosdx/utils';

import {
    DEFAULT_CONNECT_TIMEOUT_MS,
    connectTimeoutFor,
} from '../../../src/core/connection/defaults.js';
import { createConnection, testConnection, discardConnection } from '../../../src/core/connection/index.js';
import { OperationAbortedError } from '../../../src/core/shared/abort.js';
import type { ConnectionConfig } from '../../../src/core/connection/types.js';

const sqliteConfig: ConnectionConfig = {
    dialect: 'sqlite',
    database: ':memory:',
};

describe('connection: connectTimeoutFor', () => {

    it('should fall back to the shared default when the config says nothing', () => {

        expect(connectTimeoutFor({})).toBe(DEFAULT_CONNECT_TIMEOUT_MS);

    });

    it('should honour an explicit override, which is the escape valve for a genuinely slow link', () => {

        expect(connectTimeoutFor({ connectTimeoutMs: 60_000 })).toBe(60_000);

    });

    it('should reject a non-positive override rather than disabling the timeout by accident', () => {

        expect(connectTimeoutFor({ connectTimeoutMs: 0 })).toBe(DEFAULT_CONNECT_TIMEOUT_MS);
        expect(connectTimeoutFor({ connectTimeoutMs: -1 })).toBe(DEFAULT_CONNECT_TIMEOUT_MS);

    });

    it('should keep the default bounded, so an unreachable host cannot wait forever', () => {

        expect(DEFAULT_CONNECT_TIMEOUT_MS).toBeGreaterThan(0);
        expect(DEFAULT_CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);

    });

});

describe('connection: cancellation', () => {

    describe('createConnection', () => {

        it('should behave exactly as before when no signal is passed', async () => {

            const conn = await createConnection(sqliteConfig);

            expect(conn.dialect).toBe('sqlite');

            await conn.destroy();

        });

        it('should ignore a signal that never fires', async () => {

            const controller = new AbortController();

            const conn = await createConnection(sqliteConfig, '__test__', {}, controller.signal);

            expect(conn.dialect).toBe('sqlite');

            await conn.destroy();

        });

        it('should refuse to open anything when the signal is already aborted', async () => {

            const controller = new AbortController();
            controller.abort();

            const [conn, err] = await attempt(() =>
                createConnection(sqliteConfig, '__test__', {}, controller.signal),
            );

            expect(err).toBeInstanceOf(OperationAbortedError);
            expect(conn).toBeNull();

        });

    });

    describe('testConnection', () => {

        it('should keep reporting ok for a reachable target with no signal', async () => {

            const result = await testConnection(sqliteConfig);

            expect(result.ok).toBe(true);
            expect(result.aborted).toBeUndefined();

        });

        it('should report aborted rather than a database failure when the caller stopped waiting', async () => {

            const controller = new AbortController();
            controller.abort();

            const result = await testConnection(sqliteConfig, { signal: controller.signal });

            expect(result.ok).toBe(false);
            expect(result.aborted).toBe(true);

        });

        it('should not mark a genuine failure as aborted', async () => {

            const result = await testConnection(
                { dialect: 'sqlite', database: '/nope/does/not/exist/db.sqlite' },
                { testServerOnly: true },
            );

            expect(result.ok).toBe(false);
            expect(result.aborted).toBeUndefined();

        });

    });

    describe('discardConnection', () => {

        it('should close a connection nobody is holding any more', async () => {

            let destroyed = false;

            await discardConnection({
                destroy: async () => {

                    destroyed = true;

                },
            });

            expect(destroyed).toBe(true);

        });

        it('should give up on a destroy that hangs, because cleanup can hang too', async () => {

            const started = Date.now();
            const [, err] = await attempt(() =>
                discardConnection({ destroy: () => new Promise<void>(() => undefined) }, 50),
            );

            expect(err).toBeNull();
            expect(Date.now() - started).toBeLessThan(2000);

        });

    });

});
