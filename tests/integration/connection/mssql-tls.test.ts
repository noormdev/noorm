// SQL Server keeps its self-generated certificate in memory only, so there is
// no CA file to validate against: `ssl.caFile` and `tlsServerName` stay unit-level.
import { beforeAll, describe, expect, it } from 'bun:test';
import { sql } from 'kysely';

import { attempt } from '@logosdx/utils';

import { createConnection, DatabaseConnectionError } from '../../../src/core/connection/index.js';
import type { ConnectionConfig } from '../../../src/core/connection/types.js';

import { TEST_CONNECTIONS, assertTestDatabase, skipIfNoContainer } from '../../utils/db.js';

const ONE_ATTEMPT = { retries: 1, delay: 0 };

function mssqlOver(ssl: ConnectionConfig['ssl']): ConnectionConfig {

    const config = { ...TEST_CONNECTIONS.mssql, ssl };

    assertTestDatabase(config);

    return config;

}

describe('connection: MSSQL TLS', () => {

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

    });

    it('should connect encrypted when ssl.rejectUnauthorized is false', async () => {

        const conn = await createConnection(mssqlOver({ rejectUnauthorized: false }), '__test_mssql_tls__', ONE_ATTEMPT);
        const [result, err] = await attempt(() =>
            sql<{ encrypt_option: string }>`
                SELECT encrypt_option FROM sys.dm_exec_connections WHERE session_id = @@SPID
            `.execute(conn.db));

        await conn.destroy();

        if (err) throw err;

        expect(result.rows[0]?.encrypt_option).toBe('TRUE');

    });

    it('should reject the self-signed server certificate without a CA, with the hint naming ssl.caFile', async () => {

        const [conn, err] = await attempt(() => createConnection(mssqlOver(true), '__test_mssql_tls__', ONE_ATTEMPT));

        await conn?.destroy();

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('TLS certificate was rejected (DEPTH_ZERO_SELF_SIGNED_CERT)');
        expect(err?.message).toContain('ssl.caFile');

    });

});
