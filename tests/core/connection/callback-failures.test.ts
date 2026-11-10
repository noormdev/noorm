/**
 * Password-callback failures that reach the factory without a database.
 *
 * A callback may reject with anything, including nothing at all. The caller
 * must get that exact value back, and a login must never go ahead on the
 * strength of an error that happened to be falsy. A driver failure on the
 * same path is the other half: it is explained, with the driver error kept.
 */
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { attempt } from '@logosdx/utils';

import { createPostgresConnection } from '../../../src/core/connection/dialects/postgres.js';
import { DatabaseConnectionError } from '../../../src/core/connection/errors.js';
import { createConnection } from '../../../src/core/connection/factory.js';
import type { ConnectionConfig, Dialect } from '../../../src/core/connection/types.js';
import { observer, type NoormEvents } from '../../../src/core/observer.js';

type ServerDialect = Exclude<Dialect, 'sqlite'>;

const once = { retries: 1, delay: 0 };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function recordErrors(configName: string) {

    const events: NoormEvents['connection:error'][] = [];
    const stop = observer.on('connection:error', (event) => {

        if (event.configName === configName) events.push(event);

    });

    return { events, stop };

}

function message(type: string, body: Buffer): Buffer {

    const head = Buffer.alloc(5);

    head.write(type, 0);
    head.writeInt32BE(body.length + 4, 1);

    return Buffer.concat([head, body]);

}

function int32(value: number): Buffer {

    const buffer = Buffer.alloc(4);

    buffer.writeInt32BE(value);

    return buffer;

}

/** A loopback listener that asks for a cleartext password and then accepts whatever it is sent. */
function postgresStub() {

    const sockets: net.Socket[] = [];
    const server = net.createServer((socket) => {

        let stage = 0;

        sockets.push(socket);
        socket.on('error', () => undefined);
        socket.on('data', () => {

            stage++;

            if (stage === 1) socket.write(message('R', int32(3)));
            if (stage === 2) socket.write(Buffer.concat([message('R', int32(0)), message('Z', Buffer.from('I'))]));

        });

    });

    return {
        async listen(): Promise<number> {

            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

            const address = server.address();

            return address && typeof address === 'object' ? address.port : 0;

        },
        async close(): Promise<void> {

            for (const socket of sockets) socket.destroy();

            await new Promise((resolve) => server.close(resolve));

        },
    };

}

async function closedPort(): Promise<number> {

    const stub = postgresStub();
    const port = await stub.listen();

    await stub.close();

    return port;

}

describe('connection: password callback failures', () => {

    const stub = postgresStub();
    const ports: Record<ServerDialect, number> = { postgres: 0, mysql: 0, mssql: 0 };

    beforeAll(async () => {

        ports.postgres = await stub.listen();
        // MySQL and MSSQL resolve the password before they open a socket.
        ports.mysql = ports.mssql = await closedPort();

    });

    afterAll(() => stub.close());

    const config = (dialect: ServerDialect): ConnectionConfig =>
        ({ dialect, host: '127.0.0.1', port: ports[dialect], user: 'probe', database: 'probe_test', connectTimeoutMs: 2_000 });

    const rejections: [string, unknown][] = [
        ['a string', 'token expired'],
        ['undefined', undefined],
        ['null', null],
        ['an Error', new Error('credential provider unavailable')],
    ];

    describe.each<ServerDialect>(['postgres', 'mysql', 'mssql'])('on %s', (dialect) => {

        it.each(rejections)('should reject connect() with exactly %s when the callback rejects with it', async (_label, reason) => {

            const name = `__callback_failure_${dialect}__`;
            const { events, stop } = recordErrors(name);

            // `attempt` cannot tell a null rejection from success, so the outcome is read from the promise itself.
            const outcome = await createConnection(config(dialect), name, once, undefined, { password: () => Promise.reject(reason) })
                .then(() => ({ connected: true }), (rejected: unknown) => ({ rejected }));

            stop();

            expect(outcome).toEqual({ rejected: reason });
            expect(events).toEqual([{ configName: name, error: 'Runtime credential connection failed' }]);

        });

    });

    it.each<ServerDialect>(['postgres', 'mysql', 'mssql'])(
        'should explain a refused connection on %s as a DatabaseConnectionError that keeps the driver error',
        async (dialect) => {

            const refused = { ...config(dialect), port: await closedPort() };

            const [, err] = await attempt(() => createConnection(refused, '__refused__', once, undefined, { password: () => 'secret' }));

            expect(err).toBeInstanceOf(DatabaseConnectionError);
            expect(err?.cause).toBeInstanceOf(Error);
            expect(err?.cause).not.toBeInstanceOf(DatabaseConnectionError);

        },
    );

    it('should emit one login event when a later PostgreSQL login outlives the connect timeout and its callback then rejects', async () => {

        // pg reports the timeout and then the late rejection through the same callback; that is still one failed login.
        const name = '__slow_callback__';
        let calls = 0;
        const conn = await createPostgresConnection(
            { ...config('postgres'), connectTimeoutMs: 300, pool: { max: 2 } },
            {
                password: async () => {

                    if (++calls === 1) return 'first-login';

                    await wait(600);

                    throw new Error('credential provider unavailable');

                },
            },
            name,
        );
        const held = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const holder = conn.db.connection().execute(async () => {

            held.resolve();
            await release.promise;

        });

        await held.promise;

        const { events, stop } = recordErrors(name);
        const [, err] = await attempt(() => conn.db.connection().execute(async () => undefined));

        await wait(900);
        stop();
        release.resolve();
        await holder;
        await Promise.race([conn.destroy(), wait(1_000)]);

        expect(err).toBeInstanceOf(Error);
        expect(events).toEqual([{ configName: name, phase: 'login', error: 'PostgreSQL pool login failed' }]);

    });

});
