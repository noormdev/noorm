/**
 * Integration test: SDK truncate/teardown respects settings.teardown.preserveTables.
 *
 * Verifies the full chain: settings.yml → DbNamespace → truncateData → real DB.
 * Runs against a live PostgreSQL container.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { sql } from 'kysely';

import { Context } from '../../../src/sdk/context.js';
import {
    skipIfNoContainer,
    makeTestConfig,
    deployTestSchema,
    seedTestData,
    teardownTestSchema,
    TEST_CONNECTIONS,
} from '../../utils/db.js';

import type { Settings } from '../../../src/core/settings/types.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function rowCount(ctx: Context, table: string): Promise<number> {

    const result = await sql.raw(`SELECT COUNT(*) as count FROM ${table}`).execute(ctx.kysely);

    return Number((result.rows[0] as { count: string }).count);

}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('integration: sdk truncate preserve', () => {

    let ctx: Context;

    const settingsWithPreserve: Settings = {
        teardown: {
            preserveTables: ['users'],
        },
    };

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const config = makeTestConfig('pg_sdk_preserve', TEST_CONNECTIONS.postgres);

        // Pre-confirmed: these cases are about preserve-list plumbing, and
        // db:truncate/db:teardown are confirm cells even for admin, so
        // without `yes` every one of them would stop at the access gate.
        ctx = new Context(config, settingsWithPreserve, { name: 'tester', source: 'system' }, { yes: true }, '/tmp/test');
        await ctx.connect();

    }, 30_000);

    afterAll(async () => {

        if (ctx?.connected) {

            await teardownTestSchema(ctx.kysely, 'postgres');
            await ctx.disconnect();

        }

    });

    beforeEach(async () => {

        await teardownTestSchema(ctx.kysely, 'postgres');
        await deployTestSchema(ctx.kysely, 'postgres');
        await seedTestData(ctx.kysely, 'postgres');

    });

    // ─────────────────────────────────────────────────────
    // truncate
    // ─────────────────────────────────────────────────────

    it('should preserve tables from settings.teardown.preserveTables', async () => {

        // 3 users, 2 lists, 3 items seeded
        expect(await rowCount(ctx, 'users')).toBe(3);
        expect(await rowCount(ctx, 'todo_items')).toBe(3);

        const result = await ctx.noorm.db.truncate();

        // users preserved via settings — data intact
        expect(await rowCount(ctx, 'users')).toBe(3);

        // other tables truncated
        expect(await rowCount(ctx, 'todo_items')).toBe(0);
        expect(await rowCount(ctx, 'todo_lists')).toBe(0);

        expect(result.preserved).toContain('users');
        expect(result.truncated).not.toContain('users');
        expect(result.truncated).toContain('todo_items');
        expect(result.truncated).toContain('todo_lists');

    });

    it('should let user-provided preserve override settings', async () => {

        expect(await rowCount(ctx, 'users')).toBe(3);

        // Override: preserve users AND todo_lists — settings 'users' replaced by this list
        const result = await ctx.noorm.db.truncate({ preserve: ['users', 'todo_lists'] });

        // Both preserved via user option — data intact
        expect(await rowCount(ctx, 'users')).toBe(3);
        expect(await rowCount(ctx, 'todo_lists')).toBe(2);

        // todo_items truncated
        expect(await rowCount(ctx, 'todo_items')).toBe(0);

        expect(result.preserved).toContain('users');
        expect(result.preserved).toContain('todo_lists');
        expect(result.truncated).toContain('todo_items');

    });

    it('should truncate everything when called with empty preserve', async () => {

        expect(await rowCount(ctx, 'users')).toBe(3);

        // Explicitly pass empty preserve — overrides settings
        const result = await ctx.noorm.db.truncate({ preserve: [] });

        expect(await rowCount(ctx, 'users')).toBe(0);
        expect(await rowCount(ctx, 'todo_items')).toBe(0);

        // __noorm_ tables are always preserved regardless
        expect(result.truncated).toContain('users');
        expect(result.truncated).not.toContain('__noorm_change__');

    });

    it('should work with dryRun — no data changes', async () => {

        const result = await ctx.noorm.db.truncate({ dryRun: true });

        // Data untouched
        expect(await rowCount(ctx, 'users')).toBe(3);
        expect(await rowCount(ctx, 'todo_items')).toBe(3);

        // Settings preserve still reflected in result
        expect(result.preserved).toContain('users');
        expect(result.truncated).not.toContain('users');
        expect(result.statements.length).toBeGreaterThan(0);

    });

    // ─────────────────────────────────────────────────────
    // teardown
    // ─────────────────────────────────────────────────────

    it('should preserve tables from settings during teardown', async () => {

        const result = await ctx.noorm.db.teardown();

        // users table should still exist (preserved via settings)
        const usersExists = await sql.raw(`
            SELECT EXISTS (
                SELECT FROM pg_tables
                WHERE schemaname = 'public' AND tablename = 'users'
            )
        `).execute(ctx.kysely);
        expect((usersExists.rows[0] as { exists: boolean }).exists).toBe(true);

        expect(result.preserved).toContain('users');
        expect(result.dropped.tables).not.toContain('users');
        expect(result.dropped.tables).toContain('todo_items');

    });

});
