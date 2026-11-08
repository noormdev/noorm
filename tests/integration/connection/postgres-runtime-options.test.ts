import { describe, expect, it } from 'bun:test';
import { sql } from 'kysely';
import { attempt, runWithTimeout } from '@logosdx/utils';
import { observer, type NoormEvents } from '../../../src/core/observer.js';
import { createPostgresConnection } from '../../../src/core/connection/dialects/postgres.js';
import { createConnection } from '../../../src/core/connection/factory.js';
import { TEST_CONNECTIONS, assertTestDatabase } from '../../utils/db.js';

describe('PostgreSQL runtime pool options', () => {

    it('reports idle failures safely and disposes the dead physical connection', async () => {

        const config = TEST_CONNECTIONS.postgres;
        assertTestDatabase(config);
        const name = '__postgres_idle_runtime__';
        let calls = 0;
        const conn = await createPostgresConnection({ ...config, pool: { max: 1, idleTimeoutMillis: 0 } }, {
            password: () => {

                calls++;

                return config.password!;

            },
        }, name);
        const control = await createPostgresConnection(config);
        const events: NoormEvents['connection:error'][] = [];
        const { promise: idle, resolve: received } = Promise.withResolvers<NoormEvents['connection:error']>();
        const stop = observer.on('connection:error', (event) => {

            if (event.configName === name) {

                events.push(event);
                received(event);

            }

        });
        const [, err] = await attempt(async () => {

            const first = await sql<{ id: number }>`SELECT pg_backend_pid() AS id`.execute(conn.db);
            expect(calls).toBe(1);

            const terminated = await sql<{ terminated: boolean }>`
                SELECT pg_terminate_backend(${first.rows[0]!.id}) AS terminated
            `.execute(control.db);
            expect(terminated.rows[0]!.terminated).toBe(true);
            const event = await runWithTimeout(() => idle, { timeout: 3_000, throws: true });

            expect(event).toEqual({
                configName: name,
                phase: 'idle',
                error: 'PostgreSQL idle pool connection failed',
            });

            const replacement = await sql<{ id: number }>`SELECT pg_backend_pid() AS id`.execute(conn.db);
            expect(replacement.rows[0]!.id).not.toBe(first.rows[0]!.id);
            expect(calls).toBe(2);
            expect(events).toEqual([event]);

        });

        stop();
        await Promise.all([conn.destroy(), control.destroy()]);

        if (err) throw err;

    });

    it('reports checked-out failures without reacquiring the pinned connection', async () => {

        const config = TEST_CONNECTIONS.postgres;
        assertTestDatabase(config);
        const name = '__postgres_checked_out_runtime__';
        let calls = 0;
        const conn = await createPostgresConnection({ ...config, pool: { max: 1, idleTimeoutMillis: 0 } }, {
            password: () => {

                calls++;

                return config.password!;

            },
        }, name);
        const control = await createPostgresConnection(config);
        const events: NoormEvents['connection:error'][] = [];
        const { promise: failed, resolve: received } = Promise.withResolvers<NoormEvents['connection:error']>();
        const stop = observer.on('connection:error', (event) => {

            if (event.configName === name) {

                events.push(event);
                received(event);

            }

        });
        const [, err] = await attempt(async () => {

            const first = await sql<{ id: number }>`SELECT pg_backend_pid() AS id`.execute(conn.db);
            await conn.db.connection().execute(async (db) => {

                const pinned = await sql<{ id: number }>`SELECT pg_backend_pid() AS id`.execute(db);
                expect(pinned.rows[0]!.id).toBe(first.rows[0]!.id);
                expect(calls).toBe(1);

                const terminated = await sql<{ terminated: boolean }>`
                    SELECT pg_terminate_backend(${pinned.rows[0]!.id}) AS terminated
                `.execute(control.db);
                expect(terminated.rows[0]!.terminated).toBe(true);
                const event = await runWithTimeout(() => failed, { timeout: 3_000, throws: true });

                expect(event).toEqual({
                    configName: name,
                    phase: 'checked-out',
                    error: 'PostgreSQL checked-out connection failed',
                });
                await expect(sql`SELECT 1`.execute(db)).rejects.toThrow('not queryable');
                expect(calls).toBe(1);
                expect(events).toEqual([event]);

            });

            const replacement = await sql<{ id: number }>`SELECT pg_backend_pid() AS id`.execute(conn.db);
            expect(replacement.rows[0]!.id).not.toBe(first.rows[0]!.id);
            expect(calls).toBe(2);
            expect(events).toHaveLength(1);

        });

        stop();
        await Promise.all([conn.destroy(), control.destroy()]);

        if (err) throw err;

    });


    it('refreshes credentials for new physical connections', async () => {

        let calls = 0;
        const conn = await createPostgresConnection(
            { ...TEST_CONNECTIONS.postgres, pool: { max: 2 } },
            { password: () => {

                calls++;

                return TEST_CONNECTIONS.postgres.password!;

            } },
        );
        try {

            await Promise.all([
                sql`SELECT pg_sleep(0.2)`.execute(conn.db),
                sql`SELECT pg_sleep(0.2)`.execute(conn.db),
            ]);
            expect(calls).toBe(2);
            await sql`SELECT 1`.execute(conn.db);
            expect(calls).toBe(2);

        }
        finally {

            await conn.destroy();

        }

    });

    it('propagates the original credential error through the driver and factory', async () => {

        const secret = 'private-postgres-provider-token';
        const failure = Object.assign(new Error(`credential provider failed: ${secret}`), {
            code: 'ECONNREFUSED',
            serverMessage: secret,
        });
        let calls = 0;
        const runtime = { password: async () => {

            calls++;
            throw failure;

        } };
        const conn = await createPostgresConnection(TEST_CONNECTIONS.postgres, runtime);

        try {

            await expect(sql`SELECT 1`.execute(conn.db)).rejects.toBe(failure);
            expect(calls).toBe(1);

        }
        finally {

            await conn.destroy();

        }

        calls = 0;
        const events: NoormEvents['connection:error'][] = [];
        const stop = observer.on('connection:error', (event) => {

            events.push(event);

        });
        const [, err] = await attempt(async () => {

            await expect(createConnection(TEST_CONNECTIONS.postgres, '__test__', { retries: 3, delay: 0 }, undefined, runtime)).rejects.toBe(failure);
            expect(calls).toBe(1);
            expect(events).toEqual([{
                configName: '__test__',
                error: 'Runtime credential connection failed',
            }]);
            expect(JSON.stringify(events)).not.toContain(secret);

        });

        stop();

        if (err) throw err;

    });

    it('sets session options and enforces the server statement timeout', async () => {

        const conn = await createPostgresConnection({
            ...TEST_CONNECTIONS.postgres,
            applicationName: 'noorm-runtime-test',
            statementTimeoutMs: 100,
            queryTimeoutMs: 0,
            keepAlive: true,
        });
        try {

            const result = await sql<{ app: string; timeout: string }>`
                SELECT current_setting('application_name') AS app, current_setting('statement_timeout') AS timeout
            `.execute(conn.db);
            expect(result.rows[0]?.app).toBe('noorm-runtime-test');
            expect(result.rows[0]?.timeout).toBe('100ms');
            await expect(sql`SELECT pg_sleep(1)`.execute(conn.db)).rejects.toThrow();

        }
        finally {

            await conn.destroy();

        }

    });

});
