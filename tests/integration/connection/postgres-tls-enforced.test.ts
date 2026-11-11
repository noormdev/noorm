// The server is the `postgres-tls` service of docker-compose.test.yml: TLS only,
// and a client certificate on every login. Setup: "Live TLS Tests" in docs/dev/ci.md.
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
const ENCRYPTED_AS_CLIENT = { ssl: true, client_dn: '/CN=noorm_tls' };

const session = sql<{ ssl: boolean; client_dn: string | null }>`
    SELECT ssl, client_dn FROM pg_stat_ssl WHERE pid = pg_backend_pid()
`;

function postgresOver(tls: Pick<ConnectionConfig, 'ssl' | 'tlsServerName'>): ConnectionConfig {

    return {
        dialect: 'postgres',
        host: 'localhost',
        port: tlsPort('TEST_POSTGRES_TLS_PORT', 15433),
        user: 'noorm_tls',
        password: 'noorm_tls',
        database: 'noorm_tls_test',
        ...tls,
    };

}

describe.skipIf(!TLS_DIR)('connection: PostgreSQL enforced TLS', () => {

    it('should connect encrypted with ssl.caFile, tlsServerName and a client certificate', async () => {

        const rows = await rowsOver(postgresOver({ ssl: { ...ca, ...client }, tlsServerName: TLS_SERVER_NAME }), session);

        expect(rows).toEqual([ENCRYPTED_AS_CLIENT]);

    });

    it('should connect through the SDK with certificate paths relative to the project root', async () => {

        const rows = await rowsThroughSdk((root) => postgresOver({
            ssl: {
                caFile: tlsFile('ca.pem', root),
                certFile: tlsFile('client.pem', root),
                keyFile: tlsFile('client.key', root),
            },
            tlsServerName: TLS_SERVER_NAME,
        }), session);

        expect(rows).toEqual([ENCRYPTED_AS_CLIENT]);

    });

    it('should reject the server certificate under an unrelated CA, with the hint naming ssl.caFile', async () => {

        const err = await rejection(postgresOver({
            ssl: { caFile: tlsFile('other-ca.pem'), ...client },
            tlsServerName: TLS_SERVER_NAME,
        }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('TLS certificate was rejected (SELF_SIGNED_CERT_IN_CHAIN)');
        expect(err?.message).toContain('ssl.caFile');

    });

    it('should reject the server certificate without a CA, with the hint naming ssl.caFile', async () => {

        const err = await rejection(postgresOver({ ssl: true }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('TLS certificate was rejected (SELF_SIGNED_CERT_IN_CHAIN)');
        expect(err?.message).toContain('ssl.caFile');

    });

    it('should reject localhost when tlsServerName is not set, with the hostname hint', async () => {

        const err = await rejection(postgresOver({ ssl: { ...ca, ...client } }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('issued for a different hostname (ERR_TLS_CERT_ALTNAME_INVALID: Host: localhost.');
        expect(err?.message).toContain('Set tlsServerName');

    });

    it('should reject a tlsServerName the certificate is not issued for, with the hostname hint', async () => {

        const err = await rejection(postgresOver({ ssl: { ...ca, ...client }, tlsServerName: 'wrong.invalid' }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toContain('issued for a different hostname (ERR_TLS_CERT_ALTNAME_INVALID: Host: wrong.invalid.');
        expect(err?.message).toContain('Set tlsServerName');

    });

    it('should surface the server refusal when no client certificate is presented', async () => {

        const err = await rejection(postgresOver({ ssl: ca, tlsServerName: TLS_SERVER_NAME }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toBe('connection requires a valid client certificate');

    });

    it('should connect encrypted without validating when ssl.rejectUnauthorized is false', async () => {

        const rows = await rowsOver(postgresOver({ ssl: { rejectUnauthorized: false, ...client } }), session);

        expect(rows).toEqual([ENCRYPTED_AS_CLIENT]);

    });

    it('should be refused by the server in plaintext', async () => {

        const err = await rejection(postgresOver({ ssl: false }));

        expect(err).toBeInstanceOf(DatabaseConnectionError);
        expect(err?.message).toBe(
            'The server\'s pg_hba.conf has no rule that lets user \'noorm_tls\' connect to \'noorm_tls_test\' from this machine.',
        );

    });

    it('should fail on a missing ssl.caFile before any socket is opened', async () => {

        const missing = tlsFile('missing.pem');
        const { err, opened } = await rejectionBeforeDial(postgresOver({
            ssl: { caFile: missing, ...client },
            tlsServerName: TLS_SERVER_NAME,
        }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err?.message).toBe(`Cannot read ssl.caFile '${missing}': ENOENT`);
        expect(opened).toBe(0);

    });

});
