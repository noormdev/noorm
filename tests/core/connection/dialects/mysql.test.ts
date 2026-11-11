/**
 * Closing a MySQL connection without a goodbye.
 *
 * `discard()` exists for a session that has stopped answering. Such a server
 * is not reading either, so only destroying the socket is certain to free it.
 */
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import mysql2 from 'mysql2';
import { attemptSync } from '@logosdx/utils';

import type { ConnectionConfig } from '../../../../src/core/connection/types.js';
import { buildMysqlOptions, closeMysqlConnection } from '../../../../src/core/connection/dialects/mysql.js';

describe('connection: mysql close', () => {

    const peers: net.Socket[] = [];
    // Accepts and never reads, so it never sees the client end its side.
    const server = net.createServer({ pauseOnConnect: true }, (socket) => peers.push(socket));
    let port = 0;

    beforeAll(async () => {

        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

        const address = server.address();

        if (address && typeof address === 'object') port = address.port;

    });

    afterAll(async () => {

        for (const peer of peers) peer.destroy();

        await new Promise((resolve) => server.close(resolve));

    });

    it('should destroy the socket when the server is not reading', async () => {

        const connection = mysql2.createConnection({ host: '127.0.0.1', port, user: 'probe', connectTimeout: 60_000 });
        const stream: net.Socket = connection.stream;

        connection.on('error', () => undefined);
        await new Promise((resolve) => stream.once('connect', resolve));

        closeMysqlConnection(connection);

        expect(stream.destroyed).toBe(true);

    });

});

describe('connection: mysql tls options', () => {

    const target: ConnectionConfig = { dialect: 'mysql', host: 'db.example.com', port: 3307, database: 'app', user: 'app' };

    it('should pass ca, cert, key and rejectUnauthorized to mysql2', () => {

        const ssl = { ca: 'CA', cert: 'CERT', key: 'KEY', rejectUnauthorized: true };
        const { connection } = buildMysqlOptions({ ...target, ssl });

        expect(connection.ssl).toEqual(ssl);
        expect(connection.ssl).not.toHaveProperty('verifyIdentity');

    });

    it('should never hand file fields to mysql2', () => {

        const { connection } = buildMysqlOptions({ ...target, ssl: { caFile: '/x/ca.pem', certFile: '/x/c.pem', keyFile: '/x/k.pem' } });

        expect(connection.ssl).toEqual({});

    });

    it('should keep ssl: true as an empty options object and ssl: false as undefined', () => {

        expect(buildMysqlOptions({ ...target, ssl: true }).connection.ssl).toEqual({});
        expect(buildMysqlOptions({ ...target, ssl: false }).connection.ssl).toBeUndefined();
        expect(buildMysqlOptions(target).connection.ssl).toBeUndefined();

    });

    it('should set the TLS name as host, verify identity and dial the real host through a stream', () => {

        const { connection } = buildMysqlOptions({ ...target, ssl: true, tlsServerName: 'db.internal.example' });

        expect(connection.host).toBe('db.internal.example');
        expect(connection.ssl).toMatchObject({ verifyIdentity: true });
        expect(typeof connection.stream).toBe('function');

    });

    it('should leave verifyIdentity and stream unset without tlsServerName', () => {

        const { connection } = buildMysqlOptions({ ...target, ssl: true });

        expect(connection.host).toBe('db.example.com');
        expect(connection.ssl).not.toHaveProperty('verifyIdentity');
        expect(connection.stream).toBeUndefined();

    });

    it('should treat an empty tlsServerName as absent', () => {

        const { connection } = buildMysqlOptions({ ...target, ssl: true, tlsServerName: '' });

        expect(connection.host).toBe('db.example.com');
        expect(connection.ssl).not.toHaveProperty('verifyIdentity');
        expect(connection.stream).toBeUndefined();

    });

    it('should require ssl when tlsServerName is set', () => {

        const [, err] = attemptSync(() => buildMysqlOptions({ ...target, tlsServerName: 'db.internal.example' }));

        expect(err?.message).toBe('MySQL TLS identity options require ssl to be enabled explicitly');

    });

    it('should refuse an IP address as tlsServerName', () => {

        for (const tlsServerName of ['10.0.0.5', '::1']) {

            const [, err] = attemptSync(() => buildMysqlOptions({ ...target, ssl: true, tlsServerName }));

            expect(err?.message).toContain('tlsServerName');
            expect(err?.message).toContain(`'${tlsServerName}'`);

        }

    });

    it('should refuse tlsServerName with certificate verification off', () => {

        const [, err] = attemptSync(() => buildMysqlOptions({
            ...target,
            ssl: { rejectUnauthorized: false },
            tlsServerName: 'db.internal.example',
        }));

        expect(err?.message).toBe('MySQL TLS identity options require certificate verification');

    });

});

describe('connection: mysql dialed stream', () => {

    type Call = { method: 'setNoDelay' | 'setKeepAlive'; args: unknown[]; socket: net.Socket };

    const accepted: net.Socket[] = [];
    const listener = net.createServer((socket) => accepted.push(socket));
    let port = 0;

    beforeAll(async () => {

        await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));

        const address = listener.address();

        if (address && typeof address === 'object') port = address.port;

    });

    afterAll(async () => {

        for (const peer of accepted) peer.destroy();

        await new Promise((resolve) => listener.close(resolve));

    });

    async function dial(overrides: Partial<ConnectionConfig>, driver?: Record<string, unknown>) {

        const calls: Call[] = [];
        const setNoDelay = net.Socket.prototype.setNoDelay;
        const setKeepAlive = net.Socket.prototype.setKeepAlive;

        net.Socket.prototype.setNoDelay = function (...args) {

            calls.push({ method: 'setNoDelay', args, socket: this });

            return setNoDelay.apply(this, args);

        };
        net.Socket.prototype.setKeepAlive = function (...args) {

            calls.push({ method: 'setKeepAlive', args, socket: this });

            return setKeepAlive.apply(this, args);

        };

        const { connection } = buildMysqlOptions(
            { dialect: 'mysql', host: '127.0.0.1', port, database: 'app', user: 'app', ssl: true, tlsServerName: 'db.internal.example', ...overrides },
            driver ? { driver } : undefined,
        );
        const client = mysql2.createConnection({ ...connection, connectTimeout: 60_000 });

        let timer: ReturnType<typeof setTimeout> | undefined;

        try {

            client.on('error', () => undefined);

            await Promise.race([
                new Promise((resolve) => listener.once('connection', resolve)),
                new Promise((_, reject) => {

                    timer = setTimeout(() => reject(new Error('the dialed stream never reached the listener')), 5_000);

                }),
            ]);

            const dialed: net.Socket = client.stream;

            return calls
                .filter((call) => call.socket === dialed)
                .map(({ method, args }) => ({ method, args }));

        }
        finally {

            clearTimeout(timer);
            net.Socket.prototype.setNoDelay = setNoDelay;
            net.Socket.prototype.setKeepAlive = setKeepAlive;
            closeMysqlConnection(client);

        }

    }

    it('should dial the real host and port, not the TLS name', async () => {

        const before = accepted.length;

        await dial({});

        expect(accepted).toHaveLength(before + 1);

    });

    it('should enable no-delay and keepalive by default', async () => {

        const calls = await dial({});

        expect(calls).toContainEqual({ method: 'setNoDelay', args: [true] });
        expect(calls).toContainEqual({ method: 'setKeepAlive', args: [true, undefined] });

    });

    it('should pass keepAliveInitialDelayMs to setKeepAlive', async () => {

        const calls = await dial({ keepAliveInitialDelayMs: 10_000 });

        expect(calls).toContainEqual({ method: 'setKeepAlive', args: [true, 10_000] });

    });

    it('should leave keepalive off for keepAlive: false', async () => {

        const calls = await dial({ keepAlive: false });

        expect(calls.filter((call) => call.method === 'setKeepAlive')).toEqual([]);
        expect(calls).toContainEqual({ method: 'setNoDelay', args: [true] });

    });

    it('should let a driver override of keepAliveInitialDelay reach the socket', async () => {

        const calls = await dial({ keepAliveInitialDelayMs: 10_000 }, { keepAliveInitialDelay: 4_000 });

        expect(calls).toContainEqual({ method: 'setKeepAlive', args: [true, 4_000] });

    });

    it('should let a driver override of enableKeepAlive turn keepalive off', async () => {

        const calls = await dial({}, { enableKeepAlive: false });

        expect(calls.filter((call) => call.method === 'setKeepAlive')).toEqual([]);

    });

});
