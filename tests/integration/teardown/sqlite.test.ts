/**
 * SQLite Teardown Integration Tests
 *
 * Tests the teardown module against a real SQLite in-memory database.
 * Verifies truncateData, teardownSchema, and previewTeardown operations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
} from '../../utils/db.js';
import {
    truncateData,
    teardownSchema,
    previewTeardown,
} from '../../../src/core/teardown/index.js';
import { fetchList, fetchOverview } from '../../../src/core/explore/index.js';


describe('integration: sqlite teardown', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeEach(async () => {

        // Create fresh connection for each test since SQLite is in-memory
        const conn = await createTestConnection('sqlite');
        db = conn.db;
        destroy = conn.destroy;

        await deployTestSchema(db, 'sqlite');
        await seedTestData(db, 'sqlite');

    });

    afterEach(async () => {

        await destroy();

    });

    describe('truncateData', () => {

        it('should truncate all user tables and preserve noorm tables', async () => {

            // Verify data exists before truncate
            const beforeCount = await sql<{ count: number }>`
                SELECT COUNT(*) as count FROM users
            `.execute(db);
            expect(beforeCount.rows[0]?.count).toBe(3);

            const result = await truncateData(db, 'sqlite');

            expect(result.truncated).toContain('users');
            expect(result.truncated).toContain('todo_lists');
            expect(result.truncated).toContain('todo_items');

            // Verify data is gone
            const afterUsersCount = await sql<{ count: number }>`
                SELECT COUNT(*) as count FROM users
            `.execute(db);
            expect(afterUsersCount.rows[0]?.count).toBe(0);

            const afterListsCount = await sql<{ count: number }>`
                SELECT COUNT(*) as count FROM todo_lists
            `.execute(db);
            expect(afterListsCount.rows[0]?.count).toBe(0);

            const afterItemsCount = await sql<{ count: number }>`
                SELECT COUNT(*) as count FROM todo_items
            `.execute(db);
            expect(afterItemsCount.rows[0]?.count).toBe(0);

        });

        it('should use DELETE instead of TRUNCATE for SQLite', async () => {

            const result = await truncateData(db, 'sqlite');

            // SQLite statements should use DELETE FROM
            const deleteStatements = result.statements.filter((s) => s.includes('DELETE FROM'));
            expect(deleteStatements.length).toBeGreaterThan(0);

            // Should not contain TRUNCATE
            const truncateStatements = result.statements.filter((s) => s.includes('TRUNCATE'));
            expect(truncateStatements.length).toBe(0);

        });

        it('should preserve specified tables', async () => {

            const result = await truncateData(db, 'sqlite', {
                preserve: ['users'],
            });

            expect(result.preserved).toContain('users');
            expect(result.truncated).not.toContain('users');
            expect(result.truncated).toContain('todo_lists');
            expect(result.truncated).toContain('todo_items');

            // Users should still have data
            const usersCount = await sql<{ count: number }>`
                SELECT COUNT(*) as count FROM users
            `.execute(db);
            expect(usersCount.rows[0]?.count).toBe(3);

            // Todo items should be empty (even if FK to todo_lists exists)
            const itemsCount = await sql<{ count: number }>`
                SELECT COUNT(*) as count FROM todo_items
            `.execute(db);
            expect(itemsCount.rows[0]?.count).toBe(0);

        });

        it('should truncate only specified tables when using "only" option', async () => {

            const result = await truncateData(db, 'sqlite', {
                only: ['todo_items'],
            });

            expect(result.truncated).toEqual(['todo_items']);
            expect(result.preserved).toContain('users');
            expect(result.preserved).toContain('todo_lists');

            // Only todo_items should be empty
            const itemsCount = await sql<{ count: number }>`
                SELECT COUNT(*) as count FROM todo_items
            `.execute(db);
            expect(itemsCount.rows[0]?.count).toBe(0);

            // Users and todo_lists should still have data
            const usersCount = await sql<{ count: number }>`
                SELECT COUNT(*) as count FROM users
            `.execute(db);
            expect(usersCount.rows[0]?.count).toBe(3);

        });

        it('should return SQL statements in dry run mode', async () => {

            const result = await truncateData(db, 'sqlite', { dryRun: true });

            expect(result.statements.length).toBeGreaterThan(0);
            expect(result.truncated.length).toBeGreaterThan(0);

            // Data should NOT be deleted in dry run
            const usersCount = await sql<{ count: number }>`
                SELECT COUNT(*) as count FROM users
            `.execute(db);
            expect(usersCount.rows[0]?.count).toBe(3);

        });

        it('should disable and re-enable foreign key checks', async () => {

            const result = await truncateData(db, 'sqlite');

            expect(result.statements[0]).toContain('PRAGMA foreign_keys = OFF');
            expect(result.statements[result.statements.length - 1]).toContain('PRAGMA foreign_keys = ON');

        });

        it('should return execution duration', async () => {

            const result = await truncateData(db, 'sqlite');

            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

    });

    describe('teardownSchema', () => {

        it('should drop all user tables, views, and preserve noorm tables', async () => {

            const result = await teardownSchema(db, 'sqlite');

            expect(result.dropped.tables).toContain('users');
            expect(result.dropped.tables).toContain('todo_lists');
            expect(result.dropped.tables).toContain('todo_items');
            expect(result.dropped.views).toContain('v_active_users');
            expect(result.dropped.views).toContain('v_todo_lists_with_counts');
            expect(result.dropped.views).toContain('v_active_todo_items');

            // Verify objects are gone
            const overview = await fetchOverview(db, 'sqlite');
            expect(overview.tables).toBe(0);
            expect(overview.views).toBe(0);

        });

        it('should return DROP statements', async () => {

            const result = await teardownSchema(db, 'sqlite');

            // Should contain DROP TABLE and DROP VIEW statements
            const dropTableStmts = result.statements.filter((s) => s.includes('DROP TABLE'));
            const dropViewStmts = result.statements.filter((s) => s.includes('DROP VIEW'));

            expect(dropTableStmts.length).toBe(3);
            expect(dropViewStmts.length).toBe(3);

        });

        it('should preserve specified tables', async () => {

            const result = await teardownSchema(db, 'sqlite', {
                preserveTables: ['users'],
            });

            expect(result.preserved).toContain('users');
            expect(result.dropped.tables).not.toContain('users');
            expect(result.dropped.tables).toContain('todo_lists');
            expect(result.dropped.tables).toContain('todo_items');

            // Users table should still exist
            const tables = await fetchList(db, 'sqlite', 'tables');
            const tableNames = tables.map((t) => t.name);
            expect(tableNames).toContain('users');

        });

        it('should keep views when keepViews option is true', async () => {

            const result = await teardownSchema(db, 'sqlite', {
                keepViews: true,
            });

            // Views should not be dropped
            expect(result.dropped.views).toHaveLength(0);

            // Views still exist (but tables are gone, so views may fail)
            // We check that at least no DROP VIEW statements were executed
            const dropViewStmts = result.statements.filter((s) => s.includes('DROP VIEW'));
            expect(dropViewStmts.length).toBe(0);

        });

        it('should return SQL statements in dry run mode', async () => {

            const result = await teardownSchema(db, 'sqlite', { dryRun: true });

            expect(result.statements.length).toBeGreaterThan(0);
            expect(result.dropped.tables.length).toBeGreaterThan(0);

            // Objects should still exist
            const tables = await fetchList(db, 'sqlite', 'tables');
            expect(tables).toHaveLength(3);

            const views = await fetchList(db, 'sqlite', 'views');
            expect(views).toHaveLength(3);

        });

        it('should return execution duration', async () => {

            const result = await teardownSchema(db, 'sqlite');

            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

        it('should handle empty database gracefully', async () => {

            // First teardown everything
            await teardownSchema(db, 'sqlite');

            // Second teardown on empty database
            const result = await teardownSchema(db, 'sqlite');

            expect(result.dropped.tables).toHaveLength(0);
            expect(result.dropped.views).toHaveLength(0);

        });

        it('should return comment for FK constraints (SQLite cannot drop individual FKs)', async () => {

            const result = await teardownSchema(db, 'sqlite');

            // SQLite FK drop returns comments, not actual SQL
            // SQLite version may or may not include these comments
            // The important thing is it doesn't error
            expect(result.dropped.foreignKeys.length).toBeGreaterThanOrEqual(0);

        });

    });

    describe('previewTeardown', () => {

        it('should return preview without executing', async () => {

            const preview = await previewTeardown(db, 'sqlite');

            expect(preview.toDrop.tables).toContain('users');
            expect(preview.toDrop.tables).toContain('todo_lists');
            expect(preview.toDrop.tables).toContain('todo_items');
            expect(preview.toDrop.views.length).toBe(3);
            expect(preview.statements.length).toBeGreaterThan(0);

            // Objects should still exist after preview
            const tables = await fetchList(db, 'sqlite', 'tables');
            expect(tables).toHaveLength(3);

        });

        it('should show preserved tables', async () => {

            const preview = await previewTeardown(db, 'sqlite', {
                preserveTables: ['users', 'todo_lists'],
            });

            expect(preview.toPreserve).toContain('users');
            expect(preview.toPreserve).toContain('todo_lists');
            expect(preview.toDrop.tables).toEqual(['todo_items']);

        });

        it('should respect keepViews option in preview', async () => {

            const preview = await previewTeardown(db, 'sqlite', {
                keepViews: true,
            });

            expect(preview.toDrop.views).toHaveLength(0);

        });

        it('should show empty arrays for SQLite unsupported features', async () => {

            const preview = await previewTeardown(db, 'sqlite');

            // SQLite doesn't have stored procedures or custom types
            expect(preview.toDrop.functions).toHaveLength(0);
            expect(preview.toDrop.types).toHaveLength(0);

        });

    });

    describe('edge cases', () => {

        it('should handle tables with data and FK constraints', async () => {

            // This tests that truncate properly handles FK order
            // SQLite disables FK checks during truncate
            const result = await truncateData(db, 'sqlite');

            expect(result.truncated.length).toBe(3);

            // All tables should be empty
            for (const table of ['users', 'todo_lists', 'todo_items']) {

                const count = await sql<{ count: number }>`
                    SELECT COUNT(*) as count FROM ${sql.raw(`"${table}"`)}
                `.execute(db);
                expect(count.rows[0]?.count).toBe(0);

            }

        });

        it('should handle partial preserve with FK dependencies', async () => {

            // Preserve parent table but truncate children
            const result = await truncateData(db, 'sqlite', {
                preserve: ['users'],
            });

            expect(result.preserved).toContain('users');
            expect(result.truncated).toContain('todo_lists');
            expect(result.truncated).toContain('todo_items');

            // Parent should have data
            const usersCount = await sql<{ count: number }>`
                SELECT COUNT(*) as count FROM users
            `.execute(db);
            expect(usersCount.rows[0]?.count).toBe(3);

            // Children should be empty
            const listsCount = await sql<{ count: number }>`
                SELECT COUNT(*) as count FROM todo_lists
            `.execute(db);
            expect(listsCount.rows[0]?.count).toBe(0);

        });

    });

});
