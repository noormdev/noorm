// The server is the `mysql-tls` service of docker-compose.test.yml: TLS only, with
// `noorm_tls` created REQUIRE X509. Setup: "Live TLS Tests" in docs/dev/ci.md.
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
const client = { certFile: tlsFile('client.pem'), keyFile: tlsFile('client.key') };

const cipher = sql<{ Value: string }>`SHOW STATUS LIKE 'Ssl_cipher'`;

function mysqlOver(tls: Pick<ConnectionConfig, 'ssl' | 'tlsServerName' | 'user'>): ConnectionConfig {

    return {
        dialect: 'mysql',
        host: 'localhost',
        port: tlsPort('TEST_MYSQL_TLS_PORT', 13307),
        user: 'noorm_tls',
        password: 'noorm_tls',
        database: 'noorm_tls_test',
        ...tls,
    };

}

async function sessionCipher(config: ConnectionConfig): Promise<string | undefined> {

    const rows = await rowsOver(config, cipher);

    return rows[0]?.Value;

}

describe.skipIf(!TLS_DIR)('connection: MySQL enforced TLS', () => {

    it('should connect encrypted with ssl.caFile, tlsServerName and a client certificate', async () => {

        const config = mysqlOver({ ssl: { ...ca, ...client }, tlsServerName: TLS_SERVER_NAME });

        expect(await sessionCipher(config)).toMatch(/\S/);

    });

    it('should connect through the SDK with certificate paths relative to the project root', async () => {

        const rows = await rowsThroughSdk((root) => mysqlOver({
            ssl: {
                caFile: tlsFile('ca.pem', root),
                certFile: tlsFile('client.pem', root),
                keyFile: tlsFile('client.key', root),
            },
            tlsServerName: TLS_SERVER_NAME,
        }), cipher);

        expect(rows[0]?.Value).toMatch(/\S/);

    });

    it('should reject the server certificate under an unrelated CA, with the hint naming ssl.caFile', async () => {

        const err = await rejection(mysqlOver({
            ssl: { caFile: tlsFile('other-ca.pem'), ...client },
            tlsServerName: TLS_SERVER_NAME,
        }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('TLS certificate was rejected (SELF_SIGNED_CERT_IN_CHAIN)');
        expect(err?.message).toContain('ssl.caFile');

    });

    it('should reject the server certificate without a CA, with the hint naming ssl.caFile', async () => {

        const err = await rejection(mysqlOver({ ssl: true }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('TLS certificate was rejected (SELF_SIGNED_CERT_IN_CHAIN)');
        expect(err?.message).toContain('ssl.caFile');

    });

    // MySQL checks the certificate's name only under tlsServerName: docs/spec/connection-cert-files.md, Non-goals.
    it('should connect to localhost when tlsServerName is not set', async () => {

        expect(await sessionCipher(mysqlOver({ ssl: { ...ca, ...client } }))).toMatch(/\S/);

    });

    it('should reject a tlsServerName the certificate is not issued for, with the hostname hint', async () => {

        const err = await rejection(mysqlOver({ ssl: { ...ca, ...client }, tlsServerName: 'wrong.invalid' }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('issued for a different hostname (ERR_TLS_CERT_ALTNAME_INVALID: Host: wrong.invalid.');
        expect(err?.message).toContain('Set tlsServerName');

    });

    it('should surface the access-denied hint when no client certificate is presented', async () => {

        const err = await rejection(mysqlOver({ ssl: ca, tlsServerName: TLS_SERVER_NAME }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toStartWith('Access denied for user \'noorm_tls\'. MySQL does not tell clients why;');

    });

    it('should connect encrypted without validating when ssl.rejectUnauthorized is false', async () => {

        expect(await sessionCipher(mysqlOver({ ssl: { rejectUnauthorized: false, ...client } }))).toMatch(/\S/);

    });

    // An account that needs no certificate: for `noorm_tls` the server answers access denied before it checks the transport.
    it('should be refused by the server in plaintext, with the hint to turn ssl on', async () => {

        const err = await rejection(mysqlOver({ ssl: false, user: 'noorm_tls_password' }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toBe('The server only accepts TLS connections. Turn ssl on for this connection.');

    });

    it('should fail on a missing ssl.caFile before any socket is opened', async () => {

        const missing = tlsFile('missing.pem');
        const { err, opened } = await rejectionBeforeDial(mysqlOver({
            ssl: { caFile: missing, ...client },
            tlsServerName: TLS_SERVER_NAME,
        }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err?.message).toBe(`Cannot read ssl.caFile '${missing}': ENOENT`);
        expect(opened).toBe(0);

    });

});
