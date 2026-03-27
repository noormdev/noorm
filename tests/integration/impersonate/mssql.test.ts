/**
 * MSSQL impersonation integration test.
 *
 * Verifies EXECUTE AS USER / REVERT identity switching against a real
 * MSSQL instance. Covers callback mode (auto-revert), explicit mode
 * (manual revert), and connection pool health after impersonation.
 *
 * Requires docker-compose.test.yml containers to be running.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from 'kysely';

import { Context } from '../../../src/sdk/context.js';
import {
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

});
