/**
 * Pool and driver options observed on real pools.
 *
 * The unit tests assert the option objects; these assert that the drivers act
 * on them, which is the only proof a renamed or converted option reached the
 * place the driver reads it from.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { attempt } from '@logosdx/utils';
import { sql } from 'kysely';

import { createConnection } from '../../../src/core/connection/factory.js';
import type { ConnectionConfig, ConnectionResult, RuntimeConnectionOptions } from '../../../src/core/connection/types.js';
import { TEST_CONNECTIONS, assertTestDatabase, skipIfNoContainer } from '../../utils/db.js';

async function withConnection(
    config: ConnectionConfig,
    runtime: RuntimeConnectionOptions | undefined,
    use: (conn: ConnectionResult) => Promise<void>,
): Promise<void> {

    assertTestDatabase(config);

    const conn = await createConnection(config, '__pool_options__', { retries: 1, delay: 0 }, undefined, runtime);
    const [, err] = await attempt(() => use(conn));

    await conn.destroy();

    if (err) throw err;

}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('connection: postgres pool options on a real pool', () => {

    const base = TEST_CONNECTIONS.postgres;
    const backendPid = async (conn: ConnectionResult) =>
        (await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(conn.db)).rows[0]!.pid;

    beforeAll(() => skipIfNoContainer('postgres'));

    it('should reuse one physical connection when maxUses is not set', async () => {

        await withConnection({ ...base, pool: { max: 1 } }, undefined, async (conn) => {

            expect(await backendPid(conn)).toBe(await backendPid(conn));

        });

    });

    it('should replace a physical connection after pool.maxUses checkouts', async () => {

        await withConnection({ ...base, pool: { max: 1, maxUses: 1 } }, undefined, async (conn) => {

            expect(await backendPid(conn)).not.toBe(await backendPid(conn));

        });

    });

    it('should replace an idle physical connection older than pool.maxLifetimeMs', async () => {

        await withConnection({ ...base, pool: { max: 1, maxLifetimeMs: 1_000 } }, undefined, async (conn) => {

            const first = await backendPid(conn);

            await wait(1_500);

            expect(await backendPid(conn)).not.toBe(first);

        });

    });

    it('should let driver options override a flat config field', async () => {

        const config = { ...base, applicationName: 'from_flat_field' };

        await withConnection(config, { driver: { application_name: 'from_driver' } }, async (conn) => {

            const result = await sql<{ application_name: string }>`SHOW application_name`.execute(conn.db);

            expect(result.rows[0]!.application_name).toBe('from_driver');

        });

    });

    it('should refuse to connect when driver names the connection target', async () => {

        const [, err] = await attempt(() => withConnection(base, { driver: { host: 'elsewhere.invalid' } }, async () => {}));

        expect(err?.message).toContain('driver.host');

    });

});

describe('connection: mysql runs a string password through the Tarn pool', () => {

    const base = TEST_CONNECTIONS.mysql;
    const connectionId = async (conn: ConnectionResult) =>
        (await sql<{ id: number }>`SELECT CONNECTION_ID() AS id`.execute(conn.db)).rows[0]!.id;

    beforeAll(() => skipIfNoContainer('mysql'));

    it('should fail a checkout that waits longer than pool.acquireTimeoutMs for the only connection', async () => {

        await withConnection({ ...base, pool: { max: 1, acquireTimeoutMs: 300 } }, undefined, async (conn) => {

            const holder = sql`SELECT SLEEP(1.5)`.execute(conn.db);
            const started = Date.now();
            const [, err] = await attempt(() => sql`SELECT 1`.execute(conn.db));
            const waited = Date.now() - started;

            await holder;

            expect(err?.constructor.name).toBe('TimeoutError');
            expect(waited).toBeLessThan(1_200);

        });

    });

    it('should keep pool.min connections past the idle timeout', async () => {

        await withConnection({ ...base, pool: { min: 1, max: 2, idleTimeoutMs: 100, reapIntervalMs: 50 } }, undefined, async (conn) => {

            const first = await connectionId(conn);

            await wait(600);

            expect(await connectionId(conn)).toBe(first);

        });

    });

    it('should close a connection idle past pool.idleTimeoutMs when pool.min allows it', async () => {

        await withConnection({ ...base, pool: { min: 0, max: 2, idleTimeoutMs: 100, reapIntervalMs: 50 } }, undefined, async (conn) => {

            const first = await connectionId(conn);

            await wait(600);

            expect(await connectionId(conn)).not.toBe(first);

        });

    });

    it('should hand driver options to mysql2', async () => {

        await withConnection(base, { driver: { dateStrings: true } }, async (conn) => {

            const result = await sql<{ at: unknown }>`SELECT NOW() AS at`.execute(conn.db);

            expect(typeof result.rows[0]!.at).toBe('string');

        });

    });

});

describe('connection: mssql driver options on a real connection', () => {

    beforeAll(() => skipIfNoContainer('mssql'));

    it('should hand driver options to tedious', async () => {

        await withConnection(TEST_CONNECTIONS.mssql, { driver: { appName: 'noorm_driver_options' } }, async (conn) => {

            const result = await sql<{ name: string }>`SELECT APP_NAME() AS name`.execute(conn.db);

            expect(result.rows[0]!.name).toBe('noorm_driver_options');

        });

    });

});
