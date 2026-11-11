// The rejection cases pin the mysql2 message wordings `MYSQL_CERTIFICATE_REASONS`
// matches. Setup: "Live TLS Tests" in docs/dev/ci.md.
import { beforeAll, describe, expect, it } from 'bun:test';
import { sql } from 'kysely';

import { attempt } from '@logosdx/utils';

import { createConnection, DatabaseConnectionError } from '../../../src/core/connection/index.js';
import type { ConnectionConfig } from '../../../src/core/connection/types.js';

import { TEST_CONNECTIONS, assertTestDatabase, skipIfNoContainer } from '../../utils/db.js';

const caFile = process.env['TEST_MYSQL_CA_FILE'];
const ONE_ATTEMPT = { retries: 1, delay: 0 };

function mysqlOver(tls: Pick<ConnectionConfig, 'ssl' | 'tlsServerName'>): ConnectionConfig {

    const config = { ...TEST_CONNECTIONS.mysql, ...tls };

    assertTestDatabase(config);

    return config;

}

async function sessionCipher(config: ConnectionConfig): Promise<string | undefined> {

    const conn = await createConnection(config, '__test_mysql_tls__', ONE_ATTEMPT);
    const [result, err] = await attempt(() =>
        sql<{ Value: string }>`SHOW STATUS LIKE 'Ssl_cipher'`.execute(conn.db));

    await conn.destroy();

    if (err) throw err;

    return result.rows[0]?.Value;

}

async function rejection(config: ConnectionConfig): Promise<Error | null> {

    const [conn, err] = await attempt(() => createConnection(config, '__test_mysql_tls__', ONE_ATTEMPT));

    await conn?.destroy();

    return err;

}

describe.skipIf(!caFile)('connection: MySQL TLS with a CA file', () => {

    let mismatch: Error | null = null;

    beforeAll(async () => {

        await skipIfNoContainer('mysql');

        mismatch = await rejection(mysqlOver({ ssl: { caFile }, tlsServerName: 'wrong.invalid' }));

    });

    it('should connect encrypted when ssl.caFile names the server CA', async () => {

        expect(await sessionCipher(mysqlOver({ ssl: { caFile } }))).toMatch(/\S/);

    });

    it('should reject a tlsServerName the certificate is not issued for, with the hostname hint', () => {

        expect(mismatch).toBeInstanceOf(DatabaseConnectionError);
        expect(mismatch?.message).toContain('issued for a different hostname (ERR_TLS_CERT_ALTNAME_INVALID');
        expect(mismatch?.message).toContain('Set tlsServerName');

    });

    it('should connect when tlsServerName is the common name of the server certificate', async () => {

        const commonName = mismatch?.message.match(/is not cert's CN: ([^\s)]+)/)?.[1];

        expect(commonName).toBeDefined();
        expect(await sessionCipher(mysqlOver({ ssl: { caFile }, tlsServerName: commonName }))).toMatch(/\S/);

    });

    it('should reject the server certificate without a CA, with the hint naming ssl.caFile', async () => {

        const err = await rejection(mysqlOver({ ssl: true }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('TLS certificate was rejected (SELF_SIGNED_CERT_IN_CHAIN)');
        expect(err?.message).toContain('ssl.caFile');

    });

});
