import { beforeAll, describe, expect, it } from 'bun:test';
import { sql } from 'kysely';
import { createPostgresConnection } from '../../../src/core/connection/dialects/postgres.js';
import { TEST_CONNECTIONS, skipIfNoContainer } from '../../utils/db.js';

describe('PostgreSQL runtime pool options', () => {

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

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
