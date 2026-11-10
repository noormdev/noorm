/**
 * Closing a MySQL connection without a goodbye.
 *
 * `discard()` exists for a session that has stopped answering. Such a server
 * is not reading either, so only destroying the socket is certain to free it.
 */
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import mysql2 from 'mysql2';

import { closeMysqlConnection } from '../../../../src/core/connection/dialects/mysql.js';

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
