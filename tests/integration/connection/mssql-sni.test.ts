/**
 * Integration test: connecting to MSSQL by IP address.
 *
 * The unit tests assert the option shape; this asserts the shape actually
 * works on the wire. Connecting by IP with `encrypt: true` used to fail
 * outright — tedious forwarded the IP as the TLS SNI ServerName and Node
 * refused it (RFC 6066). The container is reachable at both `localhost` and
 * `127.0.0.1`, so the hostname case is a control for the IP case.
 *
 * Requires the docker-compose.test.yml MSSQL container on port 11433.
 * Skips with a clear message when the container is unreachable.
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import { sql } from 'kysely';

import { attempt } from '@logosdx/utils';

import { createMssqlConnection, MssqlTlsServerNameError } from '../../../src/core/connection/dialects/mssql.js';
import type { ConnectionConfig } from '../../../src/core/connection/types.js';

import { TEST_CONNECTIONS, skipIfNoContainer } from '../../utils/db.js';


/**
 * The container's own connection settings with `master` as the target, so the
 * test depends on nothing but a reachable server.
 */
function mssqlAt(host: string, overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {

    return {
        ...TEST_CONNECTIONS.mssql,
        host,
        database: 'master',
        ...overrides,
    };

}

/**
 * Open a connection, run a trivial query, and always close the pool.
 */
async function querySelectOne(config: ConnectionConfig): Promise<number> {

    const conn = await createMssqlConnection(config);

    const [rows, err] = await attempt(async () => {

        const result = await sql<{ v: number }>`SELECT 1 AS v`.execute(conn.db);

        return result.rows;

    });

    await conn.destroy();

    if (err) {

        throw err;

    }

    return rows![0]!.v;

}


describe('connection/dialects/mssql: IP connections', () => {

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

    });

    it('should connect over an encrypted channel by hostname', async () => {

        expect(await querySelectOne(mssqlAt('localhost'))).toBe(1);

    });

    it('should connect over an encrypted channel by IP address', async () => {

        expect(await querySelectOne(mssqlAt('127.0.0.1'))).toBe(1);

    });

    it('should refuse an IP connection that asks for certificate validation', async () => {

        // Refusing is the point: silently dropping to `encrypt: false` would
        // trade a failed connection for an unencrypted one.
        const [result, err] = await attempt(() => createMssqlConnection(mssqlAt('127.0.0.1', { ssl: true })));

        expect(result).toBeNull();
        expect(err).toBeInstanceOf(MssqlTlsServerNameError);
        expect(err?.message).toContain('tlsServerName');

    });

});
