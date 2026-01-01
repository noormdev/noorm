/**
 * MySQL Teardown Integration Tests.
 *
 * Tests teardown operations against a real MySQL database.
 * Requires MySQL container running on port 13306.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import {
    truncateData,
    teardownSchema,
    previewTeardown,
} from '../../../src/core/teardown/index.js';
import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
    resetTestData,
    teardownTestSchema,
    skipIfNoContainer,
} from '../../utils/db.js';

describe('integration: mysql teardown', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('mysql');

        const conn = await createTestConnection('mysql');
        db = conn.db;
        destroy = conn.destroy;

    });

    afterAll(async () => {

        if (destroy) {

            await teardownTestSchema(db, 'mysql');
            await destroy();

        }

    });

    beforeEach(async () => {

        // Reset to a clean schema state before each test
        await teardownTestSchema(db, 'mysql');
        await deployTestSchema(db, 'mysql');
        await seedTestData(db, 'mysql');

    });

    describe('truncateData', () => {

        it('should remove all rows from user tables', async () => {

            // Verify data exists before truncate
            const beforeUsers = await sql.raw('SELECT COUNT(*) as cnt FROM users').execute(db);
            expect(Number((beforeUsers.rows[0] as { cnt: number }).cnt)).toBeGreaterThan(0);

            // Execute truncate
            const result = await truncateData(db, 'mysql');

            expect(result.truncated).toContain('users');
            expect(result.truncated).toContain('todo_lists');
            expect(result.truncated).toContain('todo_items');

            // Verify data is gone
            const afterUsers = await sql.raw('SELECT COUNT(*) as cnt FROM users').execute(db);
            expect(Number((afterUsers.rows[0] as { cnt: number }).cnt)).toBe(0);

        });

        it('should preserve schema structure', async () => {

            await truncateData(db, 'mysql');

            // Tables should still exist
            const tables = await sql.raw(`
                SELECT TABLE_NAME FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME IN ('users', 'todo_lists', 'todo_items')
            `).execute(db);

            expect(tables.rows).toHaveLength(3);

        });

        it('should preserve specified tables', async () => {

            const result = await truncateData(db, 'mysql', {
                preserve: ['users'],
            });

            expect(result.preserved).toContain('users');
            expect(result.truncated).not.toContain('users');
            expect(result.truncated).toContain('todo_lists');
            expect(result.truncated).toContain('todo_items');

            // Users table should still have data
            const users = await sql.raw('SELECT COUNT(*) as cnt FROM users').execute(db);
            expect(Number((users.rows[0] as { cnt: number }).cnt)).toBeGreaterThan(0);

        });

        it('should only truncate specified tables when using only option', async () => {

            const result = await truncateData(db, 'mysql', {
                only: ['users'],
            });

            expect(result.truncated).toEqual(['users']);
            expect(result.preserved).toContain('todo_lists');
            expect(result.preserved).toContain('todo_items');

            // Users should be empty, others should have data
            const users = await sql.raw('SELECT COUNT(*) as cnt FROM users').execute(db);
            expect(Number((users.rows[0] as { cnt: number }).cnt)).toBe(0);

        });

        it('should generate correct SQL statements', async () => {

            const result = await truncateData(db, 'mysql', { dryRun: true });

            expect(result.statements.length).toBeGreaterThan(0);

            // Should have FK disable/enable statements
            const hasFkDisable = result.statements.some((s) =>
                s.includes('FOREIGN_KEY_CHECKS') || s.includes('foreign_key_checks'),
            );
            expect(hasFkDisable).toBe(true);

            // Should have TRUNCATE statements
            const hasTruncate = result.statements.some((s) =>
                s.toUpperCase().includes('TRUNCATE'),
            );
            expect(hasTruncate).toBe(true);

        });

        it('should not execute in dry run mode', async () => {

            // Get initial count
            const beforeUsers = await sql.raw('SELECT COUNT(*) as cnt FROM users').execute(db);
            const beforeCount = Number((beforeUsers.rows[0] as { cnt: number }).cnt);

            // Dry run
            await truncateData(db, 'mysql', { dryRun: true });

            // Count should be unchanged
            const afterUsers = await sql.raw('SELECT COUNT(*) as cnt FROM users').execute(db);
            expect(Number((afterUsers.rows[0] as { cnt: number }).cnt)).toBe(beforeCount);

        });

        it('should preserve noorm tables', async () => {

            // Create a mock noorm table
            await sql.raw(`
                CREATE TABLE IF NOT EXISTS __noorm_test__ (
                    id INT PRIMARY KEY,
                    data VARCHAR(100)
                )
            `).execute(db);

            await sql.raw(`
                INSERT INTO __noorm_test__ (id, data) VALUES (1, 'test')
            `).execute(db);

            const result = await truncateData(db, 'mysql');

            expect(result.preserved).toContain('__noorm_test__');
            expect(result.truncated).not.toContain('__noorm_test__');

            // Verify data preserved
            const data = await sql.raw('SELECT COUNT(*) as cnt FROM __noorm_test__').execute(db);
            expect(Number((data.rows[0] as { cnt: number }).cnt)).toBe(1);

            // Cleanup
            await sql.raw('DROP TABLE IF EXISTS __noorm_test__').execute(db);

        });

        it('should return timing information', async () => {

            const result = await truncateData(db, 'mysql');

            expect(result.durationMs).toBeDefined();
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

    });

    describe('teardownSchema', () => {

        it('should drop all user objects', async () => {

            const result = await teardownSchema(db, 'mysql');

            expect(result.dropped.tables).toContain('users');
            expect(result.dropped.tables).toContain('todo_lists');
            expect(result.dropped.tables).toContain('todo_items');
            expect(result.dropped.views.length).toBeGreaterThanOrEqual(3);

        });

        it('should preserve noorm tables', async () => {

            // Create a mock noorm table
            await sql.raw(`
                CREATE TABLE IF NOT EXISTS __noorm_test__ (
                    id INT PRIMARY KEY
                )
            `).execute(db);

            const result = await teardownSchema(db, 'mysql');

            expect(result.preserved).toContain('__noorm_test__');
            expect(result.dropped.tables).not.toContain('__noorm_test__');

            // Verify table still exists
            const tables = await sql.raw(`
                SELECT TABLE_NAME FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = '__noorm_test__'
            `).execute(db);
            expect(tables.rows).toHaveLength(1);

            // Cleanup
            await sql.raw('DROP TABLE IF EXISTS __noorm_test__').execute(db);

        });

        it('should preserve specified tables', async () => {

            const result = await teardownSchema(db, 'mysql', {
                preserveTables: ['users'],
            });

            expect(result.preserved).toContain('users');
            expect(result.dropped.tables).not.toContain('users');

            // Verify users table still exists
            const tables = await sql.raw(`
                SELECT TABLE_NAME FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'users'
            `).execute(db);
            expect(tables.rows).toHaveLength(1);

        });

        it('should keep views when keepViews is true', async () => {

            const result = await teardownSchema(db, 'mysql', {
                keepViews: true,
            });

            expect(result.dropped.views).toHaveLength(0);

            // Verify views still exist
            const views = await sql.raw(`
                SELECT TABLE_NAME FROM information_schema.VIEWS
                WHERE TABLE_SCHEMA = DATABASE()
            `).execute(db);
            expect(views.rows.length).toBeGreaterThanOrEqual(3);

        });

        it('should drop foreign keys before tables', async () => {

            const result = await teardownSchema(db, 'mysql');

            // Foreign keys should be dropped
            expect(result.dropped.foreignKeys.length).toBeGreaterThanOrEqual(2);

            // Tables should be dropped after FK constraints
            expect(result.dropped.tables).toContain('todo_items');
            expect(result.dropped.tables).toContain('todo_lists');

        });

        it('should generate correct SQL statements in dry run', async () => {

            const result = await teardownSchema(db, 'mysql', { dryRun: true });

            expect(result.statements.length).toBeGreaterThan(0);

            // Should have DROP statements
            const hasDropTable = result.statements.some((s) =>
                s.toUpperCase().includes('DROP TABLE'),
            );
            expect(hasDropTable).toBe(true);

            const hasDropView = result.statements.some((s) =>
                s.toUpperCase().includes('DROP VIEW'),
            );
            expect(hasDropView).toBe(true);

        });

        it('should not execute in dry run mode', async () => {

            await teardownSchema(db, 'mysql', { dryRun: true });

            // Tables should still exist
            const tables = await sql.raw(`
                SELECT TABLE_NAME FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME IN ('users', 'todo_lists', 'todo_items')
            `).execute(db);

            expect(tables.rows).toHaveLength(3);

        });

        it('should return timing information', async () => {

            const result = await teardownSchema(db, 'mysql');

            expect(result.durationMs).toBeDefined();
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

    });

    describe('previewTeardown', () => {

        it('should return preview without executing', async () => {

            const preview = await previewTeardown(db, 'mysql');

            expect(preview.toDrop.tables).toContain('users');
            expect(preview.toDrop.tables).toContain('todo_lists');
            expect(preview.toDrop.tables).toContain('todo_items');

            // Verify nothing was actually dropped
            const tables = await sql.raw(`
                SELECT TABLE_NAME FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME IN ('users', 'todo_lists', 'todo_items')
            `).execute(db);
            expect(tables.rows).toHaveLength(3);

        });

        it('should show objects to preserve', async () => {

            // Create a noorm table to preserve
            await sql.raw(`
                CREATE TABLE IF NOT EXISTS __noorm_test__ (id INT PRIMARY KEY)
            `).execute(db);

            const preview = await previewTeardown(db, 'mysql');

            expect(preview.toPreserve).toContain('__noorm_test__');

            // Cleanup
            await sql.raw('DROP TABLE IF EXISTS __noorm_test__').execute(db);

        });

        it('should include SQL statements that would be executed', async () => {

            const preview = await previewTeardown(db, 'mysql');

            expect(preview.statements.length).toBeGreaterThan(0);

            // Should have DROP statements
            const hasDropStatements = preview.statements.some((s) =>
                s.toUpperCase().includes('DROP'),
            );
            expect(hasDropStatements).toBe(true);

        });

        it('should respect options in preview', async () => {

            const preview = await previewTeardown(db, 'mysql', {
                preserveTables: ['users'],
                keepViews: true,
            });

            expect(preview.toPreserve).toContain('users');
            expect(preview.toDrop.views).toHaveLength(0);

        });

    });

});
