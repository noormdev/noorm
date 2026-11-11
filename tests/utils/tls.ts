/** Helpers for the enforced-TLS integration tests. Setup: "Live TLS Tests" in docs/dev/ci.md. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { attempt } from '@logosdx/utils';
import type { RawBuilder } from 'kysely';

import { createConnection } from '../../src/core/connection/index.js';
import type { ConnectionConfig } from '../../src/core/connection/types.js';
import { generateKeyPair } from '../../src/core/identity/crypto.js';
import { clearKeyOverride, setKeyOverride } from '../../src/core/identity/storage.js';
import { createContext } from '../../src/sdk/index.js';

import { assertTestDatabase } from './db.js';

const configured = process.env['TEST_TLS_DIR'];

/** Absolute fixture directory, or `undefined` when the enforced-TLS suites should skip. */
export const TLS_DIR = configured ? resolve(configured) : undefined;

/** The only name the fixture server certificates are issued for; the tests dial `localhost`. */
export const TLS_SERVER_NAME = 'db.noorm.test';

const ONE_ATTEMPT = { retries: 1, delay: 0 };
const CONFIG_NAME = '__test_tls_enforced__';

/** Path of a fixture file: absolute, or relative to `projectRoot` when one is given.
 * @example tlsFile('ca.pem'); // '/repo/tests/fixtures/tls/generated/ca.pem' */
export function tlsFile(name: string, projectRoot?: string): string {

    const path = join(TLS_DIR ?? '', name);

    return projectRoot ? relative(projectRoot, path) : path;

}

/** Port of an enforced-TLS service, movable for a machine where the default is taken.
 * @example tlsPort('TEST_POSTGRES_TLS_PORT', 15433); */
export function tlsPort(variable: string, fallback: number): number {

    return parseInt(process.env[variable] ?? String(fallback), 10);

}

/** Rows of one query over a connection that is opened and destroyed for it.
 * @example const [row] = await rowsOver(config, sql<{ ssl: boolean }>`SELECT ssl FROM pg_stat_ssl`); */
export async function rowsOver<Row>(config: ConnectionConfig, query: RawBuilder<Row>): Promise<Row[]> {

    assertTestDatabase(config);

    const conn = await createConnection(config, CONFIG_NAME, ONE_ATTEMPT);
    const [result, err] = await attempt(() => query.execute(conn.db));

    await conn.destroy();

    if (err) throw err;

    return result.rows;

}

/** The error a connection attempt fails with, or `null` when it connects.
 * @example expect(await rejection({ ...config, ssl: true })).toBeInstanceOf(DatabaseConnectionError); */
export async function rejection(config: ConnectionConfig): Promise<Error | null> {

    assertTestDatabase(config);

    const [conn, err] = await attempt(() => createConnection(config, CONFIG_NAME, ONE_ATTEMPT));

    await conn?.destroy();

    return err;

}

/** The error a connection attempt fails with when aimed at a local listener, and how many sockets that listener accepted.
 * @example const { err, opened } = await rejectionBeforeDial({ ...config, ssl: { caFile: '/missing.pem' } }); */
export async function rejectionBeforeDial(config: ConnectionConfig): Promise<{ err: Error | null; opened: number }> {

    let opened = 0;
    const listener = createServer((socket) => {

        opened++;
        socket.destroy();

    });
    const listening = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();

    listener.listen(0, () => listening.resolve());
    await listening.promise;

    const address = listener.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const err = await rejection({ ...config, host: 'localhost', port });

    listener.close(() => closed.resolve());
    await closed.promise;

    return { err, opened };

}

/** Rows of one query through the SDK, under a throwaway project root that is not the working directory.
 * @example const rows = await rowsThroughSdk((root) => ({ ...config, ssl: { caFile: tlsFile('ca.pem', root) } }), query); */
export async function rowsThroughSdk<Row>(
    connectionFor: (projectRoot: string) => ConnectionConfig,
    query: RawBuilder<Row>,
): Promise<Row[]> {

    const projectRoot = mkdtempSync(join(tmpdir(), 'noorm-tls-root-'));
    const connection = connectionFor(projectRoot);

    assertTestDatabase(connection);
    setKeyOverride(generateKeyPair().privateKey);

    const [rows, err] = await attempt(async () => {

        const ctx = await createContext({ config: false, connection, projectRoot, freshState: true });

        await ctx.connect(ONE_ATTEMPT);

        const [result, queryErr] = await attempt(() => query.execute(ctx.kysely));

        await ctx.disconnect();

        if (queryErr) throw queryErr;

        return result.rows;

    });

    clearKeyOverride();
    rmSync(projectRoot, { recursive: true, force: true });

    if (err) throw err;

    return rows;

}
