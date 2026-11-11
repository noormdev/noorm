import { afterEach, beforeEach, describe, it, expect } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPostgresPoolOptions } from '../../../../src/core/connection/dialects/postgres.js';
import { resolveSslFiles } from '../../../../src/core/connection/ssl-files.js';
import type { ConnectionConfig } from '../../../../src/core/connection/types.js';


const CA = '-----BEGIN CERTIFICATE-----\nCA-BODY\n-----END CERTIFICATE-----\n';
const CERT = '-----BEGIN CERTIFICATE-----\nCERT-BODY\n-----END CERTIFICATE-----\n';
const KEY = '-----BEGIN PRIVATE KEY-----\nKEY-BODY\n-----END PRIVATE KEY-----\n';

describe('connection/dialects/postgres: certificate files', () => {

    let dir: string;
    let base: ConnectionConfig;

    beforeEach(async () => {

        dir = await mkdtemp(join(tmpdir(), 'noorm-pg-ssl-'));
        await writeFile(join(dir, 'ca.pem'), CA);
        await writeFile(join(dir, 'cert.pem'), CERT);
        await writeFile(join(dir, 'key.pem'), KEY);

        base = {
            dialect: 'postgres',
            host: 'db.example.com',
            database: 'app',
            user: 'app',
            ssl: { caFile: join(dir, 'ca.pem'), certFile: join(dir, 'cert.pem'), keyFile: join(dir, 'key.pem') },
        };

    });

    afterEach(async () => {

        await rm(dir, { recursive: true, force: true });

    });

    it('should hand ca, cert and key to pg and no file fields', async () => {

        const { ssl } = buildPostgresPoolOptions(await resolveSslFiles(base));

        expect(ssl).toMatchObject({ ca: CA, cert: CERT, key: KEY });
        expect(ssl).not.toHaveProperty('caFile');
        expect(ssl).not.toHaveProperty('certFile');
        expect(ssl).not.toHaveProperty('keyFile');

    });

    it('should keep the PEM and no file fields when tlsServerName is set', async () => {

        const { ssl } = buildPostgresPoolOptions(await resolveSslFiles({ ...base, tlsServerName: 'pg.internal' }));

        expect(ssl).toMatchObject({ ca: CA, cert: CERT, key: KEY, servername: 'pg.internal' });
        expect(ssl).not.toHaveProperty('caFile');
        expect(ssl).not.toHaveProperty('certFile');
        expect(ssl).not.toHaveProperty('keyFile');

    });

});
