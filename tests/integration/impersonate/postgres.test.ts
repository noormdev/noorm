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
import { attempt } from '@logosdx/utils';
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

    it('refuses to impersonate a principal that does not exist', async () => {

        let callbackRan = false;

        const [, err] = await attempt(() =>
            ctx.impersonate('impersonate_no_such_role', async () => {

                callbackRan = true;

            }),
        );

        expect(err).toBeInstanceOf(Error);
        expect(callbackRan).toBe(false);

    });

    it('leaves the session identity intact after a failed impersonation', async () => {

        await attempt(() => ctx.impersonate('impersonate_no_such_role', async () => undefined));

        // A failed SET ROLE must not leave the pooled connection carrying a
        // half-applied identity for the next unrelated query to inherit.
        const result = await sql.raw('SELECT current_user AS username').execute(ctx.kysely);
        const row = (result.rows as Array<{ username: string }>)[0];

        expect(row!.username).toBe('noorm_test');

    });

    it('rejects a username carrying SQL metacharacters before it reaches the server', async () => {

        const [, err] = await attempt(() =>
            ctx.impersonate("postgres'; DROP TABLE users; --", async () => undefined),
        );

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/invalid username/i);

    });

});

/**
 * The authorization boundary proper.
 *
 * `impersonate()` is a testing affordance rather than a privilege boundary —
 * the scope hands the caller arbitrary SQL on the same connection, so `RESET
 * ROLE` is one query away. What it must never be is a privilege ESCALATION
 * path. The main suite above cannot prove that: its connection user is a
 * superuser in the test container, and postgres correctly lets a superuser
 * SET ROLE to anything. This block connects as a deliberately unprivileged
 * login role so a real membership check is exercised.
 */
describe('integration: impersonate postgres (unprivileged connection)', () => {

    let admin: Context;
    let lowPriv: Context;

    const LOWPRIV_ROLE = 'impersonate_lowpriv';
    const TARGET_ROLE = 'impersonate_target';

    /**
     * `DROP ROLE` refuses while any privilege still references the role, and
     * this suite grants CONNECT — so a plain `DROP ROLE IF EXISTS` leaks the
     * role on first teardown and then fails every later setup. `DROP OWNED BY`
     * clears those grants, but errors on a role that does not exist, hence the
     * existence check.
     */
    async function dropRoleCompletely(ctx: Context, role: string): Promise<void> {

        await sql.raw(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
                    EXECUTE 'DROP OWNED BY ${role}';
                    EXECUTE 'DROP ROLE ${role}';
                END IF;
            END $$;
        `).execute(ctx.kysely);

    }

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        admin = new Context(
            makeTestConfig('pg_impersonate_admin', TEST_CONNECTIONS.postgres),
            {}, { name: 'tester', source: 'system' }, {}, '/tmp/test',
        );
        await admin.connect();

        for (const role of [LOWPRIV_ROLE, TARGET_ROLE]) {

            await dropRoleCompletely(admin, role);

        }

        await sql.raw(
            `CREATE ROLE ${LOWPRIV_ROLE} LOGIN PASSWORD 'lowpriv123'`,
        ).execute(admin.kysely);
        await sql.raw(
            `CREATE ROLE ${TARGET_ROLE} LOGIN PASSWORD 'target123'`,
        ).execute(admin.kysely);
        await sql.raw(
            `GRANT CONNECT ON DATABASE ${TEST_CONNECTIONS.postgres.database} TO ${LOWPRIV_ROLE}`,
        ).execute(admin.kysely);

        // Deliberately no `GRANT ${TARGET_ROLE} TO ${LOWPRIV_ROLE}`.
        lowPriv = new Context(
            makeTestConfig('pg_impersonate_lowpriv', {
                ...TEST_CONNECTIONS.postgres,
                user: LOWPRIV_ROLE,
                password: 'lowpriv123',
            }),
            {}, { name: 'lowpriv', source: 'system' }, {}, '/tmp/test',
        );
        await lowPriv.connect();

    }, 30_000);

    afterAll(async () => {

        if (lowPriv?.connected) await lowPriv.disconnect();

        if (admin?.connected) {

            for (const role of [LOWPRIV_ROLE, TARGET_ROLE]) {

                await attempt(() => dropRoleCompletely(admin, role));

            }

            await admin.disconnect();

        }

    });

    it('refuses to impersonate a role the connection is not a member of', async () => {

        let callbackRan = false;

        const [, err] = await attempt(() =>
            lowPriv.impersonate(TARGET_ROLE, async () => {

                callbackRan = true;

            }),
        );

        expect(err).toBeInstanceOf(Error);
        expect(callbackRan).toBe(false);

    });

    it('leaves the unprivileged session as itself after the refused attempt', async () => {

        await attempt(() => lowPriv.impersonate(TARGET_ROLE, async () => undefined));

        const result = await sql.raw('SELECT current_user AS username').execute(lowPriv.kysely);
        const row = (result.rows as Array<{ username: string }>)[0];

        expect(row!.username).toBe(LOWPRIV_ROLE);

    });

});
