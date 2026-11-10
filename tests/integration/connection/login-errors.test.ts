/**
 * Login failures when the password comes from a callback.
 *
 * Two things are at stake. A caller must be able to tell its own callback's
 * failure (returned untouched, so it can match on identity) from the server
 * refusing the login (explained, with the driver error as `cause`). And a
 * login the pool makes after the first connect has no caller waiting on
 * `connect()`, so without a `connection:error` event a database whose password
 * rotates fails with nothing in the log but a rejected query.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { attempt } from '@logosdx/utils';
import { sql } from 'kysely';

import { DatabaseConnectionError } from '../../../src/core/connection/errors.js';
import { createConnection } from '../../../src/core/connection/factory.js';
import { PasswordCallbackRejection } from '../../../src/core/connection/login.js';
import type { ConnectionConfig, Dialect } from '../../../src/core/connection/types.js';
import { observer, type NoormEvents } from '../../../src/core/observer.js';
import { TEST_CONNECTIONS, assertTestDatabase, skipIfNoContainer } from '../../utils/db.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function recordErrors(configName: string) {

    const events: NoormEvents['connection:error'][] = [];
    const stop = observer.on('connection:error', (event) => {

        if (event.configName === configName) events.push(event);

    });

    return { events, stop };

}

interface Case {
    dialect: Exclude<Dialect, 'sqlite'>;
    rejectedCode: string;
    loginMessage: string;
    /** Pool that must open a new physical connection for the query after `settle`. */
    pool: ConnectionConfig['pool'];
    settle: () => Promise<unknown>;
}

const tarnRecycle = {
    pool: { max: 1, idleTimeoutMs: 100, reapIntervalMs: 50 },
    settle: () => wait(700),
};

const cases: Case[] = [
    {
        dialect: 'postgres',
        rejectedCode: '28P01',
        loginMessage: 'PostgreSQL pool login failed',
        pool: { max: 1, maxUses: 1 },
        settle: () => Promise.resolve(),
    },
    { dialect: 'mysql', rejectedCode: 'ER_ACCESS_DENIED_ERROR', loginMessage: 'MySQL pool login failed', ...tarnRecycle },
    { dialect: 'mssql', rejectedCode: '18456', loginMessage: 'MSSQL pool login failed', ...tarnRecycle },
];

describe.each(cases)('connection: $dialect login errors with a password callback', ({ dialect, rejectedCode, loginMessage, pool, settle }) => {

    const config = TEST_CONNECTIONS[dialect];
    const name = `__login_errors_${dialect}__`;
    const once = { retries: 1, delay: 0 };

    beforeAll(async () => {

        await skipIfNoContainer(dialect);
        assertTestDatabase(config);

    });

    it('should return the error the callback threw, unchanged, even when it carries a database-like code', async () => {

        const failure = Object.assign(new Error('credential provider unavailable'), { code: 'ECONNREFUSED' });
        const { events, stop } = recordErrors(name);

        const password = (): string => {

            throw failure;

        };

        const [, err] = await attempt(() => createConnection(config, name, once, undefined, { password }));

        stop();

        expect(err).toBe(failure);
        expect(events).toEqual([{ configName: name, error: 'Runtime credential connection failed' }]);

    });

    it.each([['a string', 'token expired'], ['undefined', undefined]])(
        'should reject connect() with exactly %s when the callback rejects with it',
        async (_label, reason) => {

            const { events, stop } = recordErrors(name);

            const outcome = await createConnection(config, name, once, undefined, { password: () => Promise.reject(reason) })
                .then((conn) => conn.destroy().then(() => ({ connected: true })), (rejected: unknown) => ({ rejected }));

            stop();

            expect(outcome).toEqual({ rejected: reason });
            expect(events).toEqual([{ configName: name, error: 'Runtime credential connection failed' }]);

        },
    );

    it('should reject the query with the thrown string as cause when a later login callback throws one', async () => {

        // No connect() caller is left to hand the bare string to, and drivers cannot carry a non-object error.
        let healthy = true;
        const conn = await createConnection({ ...config, pool }, name, once, undefined, {
            password: () => healthy ? config.password! : Promise.reject('token expired'),
        });
        const { events, stop } = recordErrors(name);

        const [, err] = await attempt(async () => {

            await settle();
            healthy = false;

            const [, queryErr] = await attempt(() => sql`SELECT 1`.execute(conn.db));

            expect(queryErr).toBeInstanceOf(PasswordCallbackRejection);
            expect(queryErr?.cause).toBe('token expired');
            expect(events).toEqual([{ configName: name, phase: 'login', error: loginMessage }]);

        });

        stop();
        await conn.destroy();

        if (err) throw err;

    });

    it('should explain a login the server rejected, keeping the driver error as cause and its code', async () => {

        const wrong = 'not-the-password-7f3a';
        const { events, stop } = recordErrors(name);

        const [, err] = await attempt(() =>
            createConnection(config, name, once, undefined, { password: async () => wrong }),
        );

        stop();

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err).toMatchObject({ serverCode: expect.stringContaining(rejectedCode) });
        expect(err?.cause).toBeInstanceOf(Error);
        expect(err?.cause).not.toBeInstanceOf(DatabaseConnectionError);
        expect(`${err?.message} ${JSON.stringify(events)}`).not.toContain(wrong);
        expect(events).toEqual([{ configName: name, error: 'Runtime credential connection failed' }]);

    });

    it('should emit one phase:login event when a later login fails, and still reject the query', async () => {

        const failure = new Error('credential provider unavailable: token-91c2');
        let healthy = true;
        const conn = await createConnection({ ...config, pool }, name, once, undefined, {
            password: () => {

                if (!healthy) throw failure;

                return config.password!;

            },
        });
        const { events, stop } = recordErrors(name);

        const [, err] = await attempt(async () => {

            await settle();
            healthy = false;

            const [, queryErr] = await attempt(() => sql`SELECT 1`.execute(conn.db));

            expect(queryErr).toBe(failure);
            expect(events).toEqual([{ configName: name, phase: 'login', error: loginMessage }]);

        });

        stop();
        await conn.destroy();

        if (err) throw err;

    });

    it('should emit phase:login when the server rejects a later login', async () => {

        let password = config.password!;
        const conn = await createConnection({ ...config, pool }, name, once, undefined, { password: () => password });
        const { events, stop } = recordErrors(name);

        const [, err] = await attempt(async () => {

            await settle();
            password = 'rotated-away-5d1e';

            const [, queryErr] = await attempt(() => sql`SELECT 1`.execute(conn.db));

            expect(queryErr).toBeInstanceOf(Error);
            expect(events).toEqual([{ configName: name, phase: 'login', error: loginMessage }]);
            expect(JSON.stringify(events)).not.toContain(password);

        });

        stop();
        await conn.destroy();

        if (err) throw err;

    });

});
