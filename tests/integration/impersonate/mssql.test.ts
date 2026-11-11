/**
 * MSSQL impersonation integration test.
 *
 * Verifies EXECUTE AS USER / REVERT identity switching against a real
 * MSSQL instance. Covers callback mode (auto-revert), explicit mode
 * (manual revert), and connection pool health after impersonation.
 *
 * Requires docker-compose.test.yml containers to be running.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'bun:test';
import { attempt } from '@logosdx/utils';
import { sql } from 'kysely';

import type { ConnectionResult } from '../../../src/core/connection/types.js';
import { Context } from '../../../src/sdk/context.js';
import {
    createTestConnection,
    skipIfNoContainer,
    makeTestConfig,
    TEST_CONNECTIONS,
} from '../../utils/db.js';

describe('integration: impersonate mssql', () => {

    let ctx: Context;

    const TEST_USER = 'impersonate_test_user';

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        const config = makeTestConfig('mssql_impersonate', TEST_CONNECTIONS.mssql);
        ctx = new Context(config, {}, { name: 'tester', source: 'system' }, {}, '/tmp/test');
        await ctx.connect();

        // Clean up any leftover test user, then create a fresh one
        await sql.raw(
            `IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${TEST_USER}') DROP USER [${TEST_USER}]`,
        ).execute(ctx.kysely);
        await sql.raw(
            `CREATE USER [${TEST_USER}] WITHOUT LOGIN`,
        ).execute(ctx.kysely);

    }, 30_000);

    afterAll(async () => {

        if (ctx?.connected) {

            await sql.raw(
                `IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${TEST_USER}') DROP USER [${TEST_USER}]`,
            ).execute(ctx.kysely);
            await ctx.disconnect();

        }

    });

    it('should switch identity in callback mode', async () => {

        const username = await ctx.impersonate(TEST_USER, async (scope) => {

            const result = await sql.raw('SELECT USER_NAME() AS username').execute(scope.kysely);
            const row = (result.rows as Array<{ username: string }>)[0];

            return row!.username;

        });

        expect(username).toBe(TEST_USER);

    });

    it('should switch and revert identity in explicit mode', async () => {

        // Verify starting identity — sa maps to dbo
        const before = await sql.raw('SELECT USER_NAME() AS username').execute(ctx.kysely);
        const originalUser = (before.rows as Array<{ username: string }>)[0]!.username;

        // Impersonate
        const scope = await ctx.impersonate(TEST_USER);
        const during = await sql.raw('SELECT USER_NAME() AS username').execute(scope.kysely);
        const impersonatedUser = (during.rows as Array<{ username: string }>)[0]!.username;

        expect(impersonatedUser).toBe(TEST_USER);

        // Revert
        await scope.revert();

        // Verify identity is restored on the main pool
        const after = await sql.raw('SELECT USER_NAME() AS username').execute(ctx.kysely);
        const restoredUser = (after.rows as Array<{ username: string }>)[0]!.username;

        expect(restoredUser).toBe(originalUser);

    });

    it('should return connection to pool after callback mode', async () => {

        // Run impersonation in callback mode
        await ctx.impersonate(TEST_USER, async (scope) => {

            await sql.raw('SELECT 1 AS n').execute(scope.kysely);

        });

        // Connection pool should still work — run a normal query
        const result = await sql.raw('SELECT USER_NAME() AS username').execute(ctx.kysely);
        const row = (result.rows as Array<{ username: string }>)[0];

        // sa maps to dbo in MSSQL
        expect(row!.username).toBe('dbo');

    });

    // REVERT cannot be made to fail on a live session here, so a second
    // connection kills the session while the pool still has it checked out.
    describe('when the revert statement fails', () => {

        let single: Context;
        let witness: ConnectionResult;

        const session = async (db: Context['kysely']) =>
            (await sql<{ spid: number; username: string }>`SELECT @@SPID AS spid, USER_NAME() AS username`.execute(db)).rows[0]!;

        const kill = (spid: number) => sql.raw(`KILL ${spid}`).execute(witness.db);

        const nextSession = () => Promise.race([
            session(single.kysely),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('the pool slot was never freed')), 10_000).unref()),
        ]);

        beforeAll(async () => {

            witness = await createTestConnection('mssql');

        });

        afterAll(() => witness.destroy());

        beforeEach(async () => {

            single = new Context(
                makeTestConfig('mssql_impersonate_discard', { ...TEST_CONNECTIONS.mssql, pool: { max: 1 } }),
                {}, { name: 'tester', source: 'system' }, {}, '/tmp/test',
            );
            await single.connect();

        });

        afterEach(() => single.disconnect());

        it('should reject in callback mode and run the next query as the login', async () => {

            const [, err] = await attempt(() => single.impersonate(TEST_USER, async (scope) => {

                await kill((await session(scope.kysely)).spid);

            }));

            expect(err).toBeInstanceOf(Error);

            const next = await nextSession();

            expect(next.username).toBe('dbo');

        }, 30_000);

        it('should free the pool slot in explicit mode, so the next query runs as the login', async () => {

            const scope = await single.impersonate(TEST_USER);

            await kill((await session(scope.kysely)).spid);

            const [, err] = await attempt(() => scope.revert());

            expect(err).toBeInstanceOf(Error);

            const next = await nextSession();

            expect(next.username).toBe('dbo');

        }, 30_000);

    });

});
