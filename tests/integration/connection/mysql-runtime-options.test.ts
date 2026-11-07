import { describe, expect, it } from 'bun:test';
import { attempt, runWithTimeout } from '@logosdx/utils';
import { sql } from 'kysely';
import { createMysqlConnection } from '../../../src/core/connection/dialects/mysql.js';
import { observer, type NoormEvents } from '../../../src/core/observer.js';
import { TEST_CONNECTIONS, assertTestDatabase } from '../../utils/db.js';

describe('MySQL runtime credentials and pool errors', () => {

    it('reports idle failures safely and refreshes the replacement physical connection', async () => {

        const config = TEST_CONNECTIONS.mysql;
        assertTestDatabase(config);
        let calls = 0;
        const name = '__mysql_idle_runtime__';
        const conn = await createMysqlConnection({ ...config, pool: { max: 1 } }, {
            password: () => {

                calls++;

                return config.password!;

            },
        }, name);
        const control = await createMysqlConnection(config);
        const events: NoormEvents['connection:error'][] = [];
        const { promise: idle, resolve: received } = Promise.withResolvers<NoormEvents['connection:error']>();
        const stop = observer.on('connection:error', (event) => {

            if (event.configName === name) {

                events.push(event);
                received(event);

            }

        });
        const [, err] = await attempt(async () => {

            const first = await sql<{ id: number }>`SELECT CONNECTION_ID() AS id`.execute(conn.db);
            expect(calls).toBe(1);

            await sql.raw(`KILL CONNECTION ${first.rows[0]!.id}`).execute(control.db);
            const event = await runWithTimeout(() => idle, { timeout: 3_000, throws: true });

            expect(event).toEqual({
                configName: name,
                phase: 'idle',
                error: 'MySQL idle pool connection failed',
            });

            const replacement = await sql<{ id: number }>`SELECT CONNECTION_ID() AS id`.execute(conn.db);
            expect(replacement.rows[0]!.id).not.toBe(first.rows[0]!.id);
            expect(calls).toBe(2);
            expect(events).toHaveLength(1);

        });

        stop();
        await Promise.all([conn.destroy(), control.destroy()]);

        if (err) throw err;

    });

    it('rejects an active query without reporting it as an idle failure', async () => {

        const config = TEST_CONNECTIONS.mysql;
        assertTestDatabase(config);
        const name = '__mysql_active_runtime__';
        const conn = await createMysqlConnection({ ...config, pool: { max: 1 } }, {
            password: () => config.password!,
        }, name);
        const control = await createMysqlConnection(config);
        const events: NoormEvents['connection:error'][] = [];
        const stop = observer.on('connection:error', (event) => {

            if (event.configName === name) events.push(event);

        });
        const [, err] = await attempt(async () => {

            await conn.db.connection().execute(async (db) => {

                const result = await sql<{ id: number }>`SELECT CONNECTION_ID() AS id`.execute(db);
                const id = result.rows[0]!.id;
                const query = attempt(() => sql`SELECT SLEEP(10)`.execute(db));
                const [, controlErr] = await attempt(async () => {

                    let running = false;

                    for (let poll = 0; poll < 100; poll++) {

                        const process = await sql<{ running: number }>`
                            SELECT COUNT(*) AS running FROM information_schema.PROCESSLIST
                            WHERE ID = ${id} AND INFO LIKE 'SELECT SLEEP%'
                        `.execute(control.db);

                        if (Number(process.rows[0]!.running) === 1) {

                            running = true;
                            break;

                        }

                    }

                    expect(running).toBe(true);
                    await sql.raw(`KILL CONNECTION ${id}`).execute(control.db);

                });
                const [, queryErr] = await query;

                if (controlErr) throw controlErr;

                expect(queryErr).toBeInstanceOf(Error);
                expect(events).toEqual([]);

            });

            expect(events).toEqual([]);
            await sql`SELECT 1`.execute(conn.db);

        });

        stop();
        await Promise.all([conn.destroy(), control.destroy()]);

        if (err) throw err;

    }, 15_000);

});
