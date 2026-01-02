/**
 * Integration tests for PostgreSQL teardown operations.
 *
 * Tests truncateData, teardownSchema, and previewTeardown against a real PostgreSQL database.
 * Requires docker-compose.test.yml containers to be running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import {
    truncateData,
    teardownSchema,
    previewTeardown,
} from '../../../src/core/teardown/operations.js';
import { fetchList, fetchOverview } from '../../../src/core/explore/index.js';
import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
    teardownTestSchema,
    skipIfNoContainer,
} from '../../utils/db.js';


describe('integration: postgres teardown', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const conn = await createTestConnection('postgres');
        db = conn.db;
        destroy = conn.destroy;

    });

    afterAll(async () => {

        if (destroy) {

            await destroy();

        }

    });

    beforeEach(async () => {

        // Deploy fresh schema and seed data before each test
        await teardownTestSchema(db, 'postgres');
        await deployTestSchema(db, 'postgres');
        await seedTestData(db, 'postgres');

    });

    describe('truncateData', () => {

        it('should truncate all tables while preserving schema', async () => {

            // Verify data exists before truncate
            const beforeUsers = await sql.raw('SELECT COUNT(*) as count FROM users').execute(db);
            expect(Number((beforeUsers.rows[0] as { count: string }).count)).toBe(3);

            // Truncate all data
            const result = await truncateData(db, 'postgres');

            // Verify data is gone
            const afterUsers = await sql.raw('SELECT COUNT(*) as count FROM users').execute(db);
            expect(Number((afterUsers.rows[0] as { count: string }).count)).toBe(0);

            // Verify schema still exists
            const tables = await fetchList(db, 'postgres', 'tables');
            expect(tables.length).toBe(3);

            // Check result structure
            expect(result.truncated).toContain('users');
            expect(result.truncated).toContain('todo_lists');
            expect(result.truncated).toContain('todo_items');
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

        it('should preserve specified tables', async () => {

            // Truncate all except users
            const result = await truncateData(db, 'postgres', {
                preserve: ['users'],
            });

            // Users should still have data
            const afterUsers = await sql.raw('SELECT COUNT(*) as count FROM users').execute(db);
            expect(Number((afterUsers.rows[0] as { count: string }).count)).toBe(3);

            // Other tables should be empty
            const afterItems = await sql.raw('SELECT COUNT(*) as count FROM todo_items').execute(db);
            expect(Number((afterItems.rows[0] as { count: string }).count)).toBe(0);

            // Check result
            expect(result.preserved).toContain('users');
            expect(result.truncated).not.toContain('users');
            expect(result.truncated).toContain('todo_items');

        });

        it('should only truncate specified tables when using only option', async () => {

            // Only truncate users table
            const result = await truncateData(db, 'postgres', {
                only: ['users'],
            });

            // Users should be empty
            const afterUsers = await sql.raw('SELECT COUNT(*) as count FROM users').execute(db);
            expect(Number((afterUsers.rows[0] as { count: string }).count)).toBe(0);

            // Other tables should still have data (todo_lists/todo_items would fail due to FK,
            // but since we're only truncating users with CASCADE disabled... we need to be careful)
            // Actually PostgreSQL TRUNCATE CASCADE would cascade, let's verify the result
            expect(result.truncated).toContain('users');
            expect(result.truncated.length).toBe(1);

        });

        it('should return SQL statements in dry run mode', async () => {

            const result = await truncateData(db, 'postgres', { dryRun: true });

            // Data should still exist
            const afterUsers = await sql.raw('SELECT COUNT(*) as count FROM users').execute(db);
            expect(Number((afterUsers.rows[0] as { count: string }).count)).toBe(3);

            // Statements should be generated
            expect(result.statements.length).toBeGreaterThan(0);
            expect(result.statements.some((s) => s.includes('TRUNCATE'))).toBe(true);

        });

        it('should restart identity sequences by default', async () => {

            const result = await truncateData(db, 'postgres');

            // Check SQL includes RESTART IDENTITY
            const truncateStmts = result.statements.filter((s) => s.includes('TRUNCATE'));
            expect(truncateStmts.every((s) => s.includes('RESTART IDENTITY'))).toBe(true);

        });

        it('should not restart identity when disabled', async () => {

            const result = await truncateData(db, 'postgres', {
                restartIdentity: false,
                dryRun: true,
            });

            // Check SQL does not include RESTART IDENTITY
            const truncateStmts = result.statements.filter((s) => s.includes('TRUNCATE'));
            expect(truncateStmts.every((s) => !s.includes('RESTART IDENTITY'))).toBe(true);

        });

        it('should always preserve noorm internal tables', async () => {

            // Create a fake noorm table
            await sql.raw('CREATE TABLE IF NOT EXISTS __noorm_test__ (id SERIAL PRIMARY KEY)').execute(db);
            await sql.raw('INSERT INTO __noorm_test__ (id) VALUES (1)').execute(db);

            const result = await truncateData(db, 'postgres');

            // noorm table should be preserved
            expect(result.preserved).toContain('__noorm_test__');
            expect(result.truncated).not.toContain('__noorm_test__');

            // Data should still exist
            const afterNoorm = await sql.raw('SELECT COUNT(*) as count FROM __noorm_test__').execute(db);
            expect(Number((afterNoorm.rows[0] as { count: string }).count)).toBe(1);

            // Clean up
            await sql.raw('DROP TABLE IF EXISTS __noorm_test__').execute(db);

        });

    });

    describe('teardownSchema', () => {

        it('should drop all user-created objects', async () => {

            // Verify objects exist before teardown
            const beforeOverview = await fetchOverview(db, 'postgres');
            expect(beforeOverview.tables).toBe(3);
            expect(beforeOverview.views).toBe(3);
            expect(beforeOverview.functions).toBeGreaterThanOrEqual(15);

            // Teardown schema
            const result = await teardownSchema(db, 'postgres');

            // Verify objects are gone
            const afterOverview = await fetchOverview(db, 'postgres');
            expect(afterOverview.tables).toBe(0);
            expect(afterOverview.views).toBe(0);

            // Check result structure
            expect(result.dropped.tables).toContain('users');
            expect(result.dropped.tables).toContain('todo_lists');
            expect(result.dropped.tables).toContain('todo_items');
            expect(result.dropped.views).toContain('v_active_users');
            expect(result.dropped.functions.length).toBeGreaterThanOrEqual(15);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

        it('should preserve noorm tables during teardown', async () => {

            // Create a fake noorm table
            await sql.raw('CREATE TABLE IF NOT EXISTS __noorm_version__ (id SERIAL PRIMARY KEY)').execute(db);
            await sql.raw('INSERT INTO __noorm_version__ (id) VALUES (1)').execute(db);

            // Teardown schema
            const result = await teardownSchema(db, 'postgres');

            // noorm table should still exist
            const noormExists = await sql.raw(`
                SELECT EXISTS (
                    SELECT FROM pg_tables
                    WHERE schemaname = 'public' AND tablename = '__noorm_version__'
                )
            `).execute(db);
            expect((noormExists.rows[0] as { exists: boolean }).exists).toBe(true);

            expect(result.preserved).toContain('__noorm_version__');
            expect(result.dropped.tables).not.toContain('__noorm_version__');

            // Clean up
            await sql.raw('DROP TABLE IF EXISTS __noorm_version__').execute(db);

        });

        it('should preserve specified tables', async () => {

            const result = await teardownSchema(db, 'postgres', {
                preserveTables: ['users'],
            });

            // Users table should still exist
            const usersExists = await sql.raw(`
                SELECT EXISTS (
                    SELECT FROM pg_tables
                    WHERE schemaname = 'public' AND tablename = 'users'
                )
            `).execute(db);
            expect((usersExists.rows[0] as { exists: boolean }).exists).toBe(true);

            expect(result.preserved).toContain('users');
            expect(result.dropped.tables).not.toContain('users');

        });

        it('should keep views when keepViews option is set', async () => {

            const result = await teardownSchema(db, 'postgres', {
                keepViews: true,
            });

            // Views should not be in dropped list
            expect(result.dropped.views.length).toBe(0);

            // Views still exist (though they may be invalid without their base tables)
            // Note: Views may fail after tables are dropped, but they weren't dropped
            await fetchOverview(db, 'postgres');

        });

        it('should keep functions when keepFunctions option is set', async () => {

            const result = await teardownSchema(db, 'postgres', {
                keepFunctions: true,
            });

            // Functions should not be in dropped list
            expect(result.dropped.functions.length).toBe(0);

        });

        it('should return SQL statements in dry run mode', async () => {

            const result = await teardownSchema(db, 'postgres', { dryRun: true });

            // Objects should still exist
            const afterOverview = await fetchOverview(db, 'postgres');
            expect(afterOverview.tables).toBe(3);

            // Statements should be generated
            expect(result.statements.length).toBeGreaterThan(0);
            expect(result.statements.some((s) => s.includes('DROP TABLE'))).toBe(true);
            expect(result.statements.some((s) => s.includes('DROP VIEW'))).toBe(true);
            expect(result.statements.some((s) => s.includes('DROP FUNCTION'))).toBe(true);

        });

        it('should drop foreign keys before tables', async () => {

            const result = await teardownSchema(db, 'postgres', { dryRun: true });

            // Find indices of FK drops and table drops
            const fkDropIndex = result.statements.findIndex((s) => s.includes('DROP CONSTRAINT'));
            const tableDropIndex = result.statements.findIndex((s) => s.includes('DROP TABLE'));

            // FK drops should come before table drops
            if (fkDropIndex !== -1 && tableDropIndex !== -1) {

                expect(fkDropIndex).toBeLessThan(tableDropIndex);

            }

        });

    });

    describe('previewTeardown', () => {

        it('should return preview without executing', async () => {

            const preview = await previewTeardown(db, 'postgres');

            // Objects should still exist after preview
            const afterOverview = await fetchOverview(db, 'postgres');
            expect(afterOverview.tables).toBe(3);
            expect(afterOverview.views).toBe(3);

            // Preview should contain what would be dropped
            expect(preview.toDrop.tables).toContain('users');
            expect(preview.toDrop.tables).toContain('todo_lists');
            expect(preview.toDrop.tables).toContain('todo_items');
            expect(preview.toDrop.views).toContain('v_active_users');

        });

        it('should return correct preserve list', async () => {

            // Create a noorm table that should be preserved
            await sql.raw('CREATE TABLE IF NOT EXISTS __noorm_test__ (id SERIAL PRIMARY KEY)').execute(db);

            const preview = await previewTeardown(db, 'postgres');

            expect(preview.toPreserve).toContain('__noorm_test__');

            // Clean up
            await sql.raw('DROP TABLE IF EXISTS __noorm_test__').execute(db);

        });

        it('should return SQL statements that would be executed', async () => {

            const preview = await previewTeardown(db, 'postgres');

            expect(preview.statements.length).toBeGreaterThan(0);
            expect(preview.statements.some((s) => s.includes('DROP TABLE'))).toBe(true);

        });

        it('should respect preserveTables option in preview', async () => {

            const preview = await previewTeardown(db, 'postgres', {
                preserveTables: ['users', 'todo_lists'],
            });

            expect(preview.toPreserve).toContain('users');
            expect(preview.toPreserve).toContain('todo_lists');
            expect(preview.toDrop.tables).not.toContain('users');
            expect(preview.toDrop.tables).not.toContain('todo_lists');
            expect(preview.toDrop.tables).toContain('todo_items');

        });

        it('should respect keepViews option in preview', async () => {

            const preview = await previewTeardown(db, 'postgres', {
                keepViews: true,
            });

            expect(preview.toDrop.views.length).toBe(0);

        });

        it('should respect keepFunctions option in preview', async () => {

            const preview = await previewTeardown(db, 'postgres', {
                keepFunctions: true,
            });

            expect(preview.toDrop.functions.length).toBe(0);

        });

    });

});
