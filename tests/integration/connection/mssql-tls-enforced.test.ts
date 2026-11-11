// The server is the `mssql-tls` service of docker-compose.test.yml. SQL Server has no
// client-certificate login, so no case presents one. Setup: "Live TLS Tests" in docs/dev/ci.md.
import { describe, expect, it } from 'bun:test';
import { sql } from 'kysely';

import { DatabaseConnectionError } from '../../../src/core/connection/index.js';
import { SslFileError } from '../../../src/core/connection/ssl-files.js';
import type { ConnectionConfig } from '../../../src/core/connection/types.js';

import {
    TLS_DIR,
    TLS_SERVER_NAME,
    rejection,
    rejectionBeforeDial,
    rowsOver,
    rowsThroughSdk,
    tlsFile,
    tlsPort,
} from '../../utils/tls.js';

const ca = { caFile: tlsFile('ca.pem') };
const ENCRYPTED = [{ encrypt_option: 'TRUE' }];

const session = sql<{ encrypt_option: string }>`
    SELECT encrypt_option FROM sys.dm_exec_connections WHERE session_id = @@SPID
`;

function mssqlOver(tls: Pick<ConnectionConfig, 'ssl' | 'tlsServerName'>): ConnectionConfig {

    return {
        dialect: 'mssql',
        host: 'localhost',
        port: tlsPort('TEST_MSSQL_TLS_PORT', 11435),
        user: 'sa',
        password: 'NoOrm_Test123!',
        database: 'noorm_tls_test',
        ...tls,
    };

}

describe.skipIf(!TLS_DIR)('connection: MSSQL enforced TLS', () => {

    it('should connect encrypted with ssl.caFile and tlsServerName', async () => {

        expect(await rowsOver(mssqlOver({ ssl: ca, tlsServerName: TLS_SERVER_NAME }), session)).toEqual(ENCRYPTED);

    });

    it('should connect through the SDK with a certificate path relative to the project root', async () => {

        const rows = await rowsThroughSdk((root) => mssqlOver({
            ssl: { caFile: tlsFile('ca.pem', root) },
            tlsServerName: TLS_SERVER_NAME,
        }), session);

        expect(rows).toEqual(ENCRYPTED);

    });

    it('should reject the server certificate under an unrelated CA, with the hint naming ssl.caFile', async () => {

        const err = await rejection(mssqlOver({ ssl: { caFile: tlsFile('other-ca.pem') }, tlsServerName: TLS_SERVER_NAME }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('TLS certificate was rejected (UNABLE_TO_VERIFY_LEAF_SIGNATURE)');
        expect(err?.message).toContain('ssl.caFile');

    });

    it('should reject the server certificate without a CA, with the hint naming ssl.caFile', async () => {

        const err = await rejection(mssqlOver({ ssl: true }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('TLS certificate was rejected (UNABLE_TO_VERIFY_LEAF_SIGNATURE)');
        expect(err?.message).toContain('ssl.caFile');

    });

    it('should reject localhost when tlsServerName is not set, with the hostname hint', async () => {

        const err = await rejection(mssqlOver({ ssl: ca }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('issued for a different hostname (ERR_TLS_CERT_ALTNAME_INVALID: Host: localhost.');
        expect(err?.message).toContain('Set tlsServerName');

    });

    it('should reject a tlsServerName the certificate is not issued for, with the hostname hint', async () => {

        const err = await rejection(mssqlOver({ ssl: ca, tlsServerName: 'wrong.invalid' }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('issued for a different hostname (ERR_TLS_CERT_ALTNAME_INVALID: Host: wrong.invalid.');
        expect(err?.message).toContain('Set tlsServerName');

    });

    it('should connect encrypted without validating when ssl.rejectUnauthorized is false', async () => {

        expect(await rowsOver(mssqlOver({ ssl: { rejectUnauthorized: false } }), session)).toEqual(ENCRYPTED);

    });

    // noorm never sends plaintext to SQL Server, so `ssl: false` meets a server that forces encryption.
    it('should connect encrypted when ssl is false', async () => {

        expect(await rowsOver(mssqlOver({ ssl: false }), session)).toEqual(ENCRYPTED);

    });

    it('should fail on a missing ssl.caFile before any socket is opened', async () => {

        const missing = tlsFile('missing.pem');
        const { err, opened } = await rejectionBeforeDial(mssqlOver({ ssl: { caFile: missing }, tlsServerName: TLS_SERVER_NAME }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err?.message).toBe(`Cannot read ssl.caFile '${missing}': ENOENT`);
        expect(opened).toBe(0);

    });

});
