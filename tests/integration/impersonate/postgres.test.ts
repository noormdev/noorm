/**
 * PostgreSQL impersonation integration test.
 *
 * Verifies SET ROLE / RESET ROLE identity switching against a real
 * PostgreSQL instance. Covers callback mode (auto-revert), explicit
 * mode (manual revert), and connection pool health after impersonation.
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

describe('integration: impersonate postgres', () => {

    let ctx: Context;

    const TEST_ROLE = 'impersonate_test_user';

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const config = makeTestConfig('pg_impersonate', TEST_CONNECTIONS.postgres);
        ctx = new Context(config, {}, { name: 'tester', source: 'system' }, {}, '/tmp/test');
        await ctx.connect();

        // Create a test role and grant SET privilege to the connected user
        await sql.raw(`DROP ROLE IF EXISTS ${TEST_ROLE}`).execute(ctx.kysely);
        await sql.raw(
            `CREATE ROLE ${TEST_ROLE} LOGIN PASSWORD 'test123'`,
        ).execute(ctx.kysely);
        await sql.raw(
            `GRANT ${TEST_ROLE} TO noorm_test WITH SET true`,
        ).execute(ctx.kysely);

    }, 30_000);

    afterAll(async () => {

        if (ctx?.connected) {

            await sql.raw('RESET ROLE').execute(ctx.kysely);
            await sql.raw(`DROP ROLE IF EXISTS ${TEST_ROLE}`).execute(ctx.kysely);
            await ctx.disconnect();

        }

    });

    it('should switch identity in callback mode', async () => {

        const username = await ctx.impersonate(TEST_ROLE, async (scope) => {

            const result = await sql.raw('SELECT current_user AS username').execute(scope.kysely);
            const row = (result.rows as Array<{ username: string }>)[0];

            return row!.username;

        });

        expect(username).toBe(TEST_ROLE);

    });

    it('should switch and revert identity in explicit mode', async () => {

        // Verify starting identity
        const before = await sql.raw('SELECT current_user AS username').execute(ctx.kysely);
        const originalUser = (before.rows as Array<{ username: string }>)[0]!.username;

        // Impersonate
        const scope = await ctx.impersonate(TEST_ROLE);
        const during = await sql.raw('SELECT current_user AS username').execute(scope.kysely);
        const impersonatedUser = (during.rows as Array<{ username: string }>)[0]!.username;

        expect(impersonatedUser).toBe(TEST_ROLE);

        // Revert
        await scope.revert();

        // Verify identity is restored on the main pool
        const after = await sql.raw('SELECT current_user AS username').execute(ctx.kysely);
        const restoredUser = (after.rows as Array<{ username: string }>)[0]!.username;

        expect(restoredUser).toBe(originalUser);

    });

    it('should return connection to pool after callback mode', async () => {

        // Run impersonation in callback mode
        await ctx.impersonate(TEST_ROLE, async (scope) => {

            await sql.raw('SELECT 1').execute(scope.kysely);

        });

        // Connection pool should still work — run a normal query
        const result = await sql.raw('SELECT current_user AS username').execute(ctx.kysely);
        const row = (result.rows as Array<{ username: string }>)[0];

        expect(row!.username).toBe('noorm_test');

    });

});
