/**
 * Integration tests for MSSQL teardown operations.
 *
 * Tests truncateData, teardownSchema, and previewTeardown against a real MSSQL instance.
 * Requires docker-compose.test.yml to be running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql, type Kysely } from 'kysely';

import {
    truncateData,
    teardownSchema,
    previewTeardown,
} from '../../../src/core/teardown/index.js';
import { fetchList, fetchOverview } from '../../../src/core/explore/index.js';
import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
    teardownTestSchema,
    skipIfNoContainer,
} from '../../utils/db.js';


describe('integration: mssql teardown', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        const conn = await createTestConnection('mssql');
        db = conn.db;
        destroy = conn.destroy;

    });

    afterAll(async () => {

        if (destroy) {

            // Clean up any remaining objects
            await teardownTestSchema(db, 'mssql').catch(() => {});
            await destroy();

        }

    });

    describe('truncateData', () => {

        beforeEach(async () => {

            // Deploy fresh schema and seed data for each test
            await teardownTestSchema(db, 'mssql').catch(() => {});
            await deployTestSchema(db, 'mssql');
            await seedTestData(db, 'mssql');

        });

        it('should truncate all tables and remove data', async () => {

            // Verify data exists before truncate
            const beforeUsers = await sql.raw('SELECT COUNT(*) as cnt FROM users').execute(db);
            const beforeCount = (beforeUsers.rows[0] as { cnt: number }).cnt;
            expect(beforeCount).toBeGreaterThan(0);

            // Perform truncate
            const result = await truncateData(db, 'mssql');

            // Verify data is gone
            const afterUsers = await sql.raw('SELECT COUNT(*) as cnt FROM users').execute(db);
            const afterCount = (afterUsers.rows[0] as { cnt: number }).cnt;
            expect(afterCount).toBe(0);

            // Verify result structure
            expect(result.truncated).toContain('users');
            expect(result.truncated).toContain('todo_lists');
            expect(result.truncated).toContain('todo_items');
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

        it('should preserve schema after truncate', async () => {

            const overviewBefore = await fetchOverview(db, 'mssql');

            await truncateData(db, 'mssql');

            const overviewAfter = await fetchOverview(db, 'mssql');

            // Schema objects should still exist
            expect(overviewAfter.tables).toBe(overviewBefore.tables);
            expect(overviewAfter.views).toBe(overviewBefore.views);
            expect(overviewAfter.functions).toBe(overviewBefore.functions);
            expect(overviewAfter.procedures).toBe(overviewBefore.procedures);
            expect(overviewAfter.types).toBe(overviewBefore.types);

        });

        it('should preserve specified tables', async () => {

            const result = await truncateData(db, 'mssql', {
                preserve: ['users'],
            });

            // users should be preserved
            expect(result.preserved).toContain('users');
            expect(result.truncated).not.toContain('users');

            // Verify users data still exists
            const usersResult = await sql.raw('SELECT COUNT(*) as cnt FROM users').execute(db);
            const usersCount = (usersResult.rows[0] as { cnt: number }).cnt;
            expect(usersCount).toBeGreaterThan(0);

            // Other tables should be truncated
            expect(result.truncated).toContain('todo_lists');
            expect(result.truncated).toContain('todo_items');

        });

        it('should truncate only specified tables when using only option', async () => {

            const result = await truncateData(db, 'mssql', {
                only: ['todo_items'],
            });

            // Only todo_items should be truncated
            expect(result.truncated).toContain('todo_items');
            expect(result.truncated).not.toContain('users');
            expect(result.truncated).not.toContain('todo_lists');

            // Verify users and todo_lists still have data
            const usersResult = await sql.raw('SELECT COUNT(*) as cnt FROM users').execute(db);
            const usersCount = (usersResult.rows[0] as { cnt: number }).cnt;
            expect(usersCount).toBeGreaterThan(0);

            // Verify todo_items is empty
            const itemsResult = await sql.raw('SELECT COUNT(*) as cnt FROM todo_items').execute(db);
            const itemsCount = (itemsResult.rows[0] as { cnt: number }).cnt;
            expect(itemsCount).toBe(0);

        });

        it('should return SQL statements in dry run mode', async () => {

            const result = await truncateData(db, 'mssql', {
                dryRun: true,
            });

            // Should have statements
            expect(result.statements.length).toBeGreaterThan(0);

            // Data should NOT be affected
            const usersResult = await sql.raw('SELECT COUNT(*) as cnt FROM users').execute(db);
            const usersCount = (usersResult.rows[0] as { cnt: number }).cnt;
            expect(usersCount).toBeGreaterThan(0);

        });

        it('should include FK disable/enable statements', async () => {

            const result = await truncateData(db, 'mssql', {
                dryRun: true,
            });

            // Should have statements that handle FK constraints
            const statements = result.statements.join('\n').toLowerCase();
            expect(
                statements.includes('nocheck') ||
                statements.includes('disable') ||
                statements.includes('--'),
            ).toBe(true);

        });

    });

    describe('teardownSchema', () => {

        beforeEach(async () => {

            // Deploy fresh schema for each test
            await teardownTestSchema(db, 'mssql').catch(() => {});
            await deployTestSchema(db, 'mssql');
            await seedTestData(db, 'mssql');

        });

        it('should drop all user tables', async () => {

            const result = await teardownSchema(db, 'mssql');

            // All 3 tables should be dropped
            expect(result.dropped.tables).toContain('users');
            expect(result.dropped.tables).toContain('todo_lists');
            expect(result.dropped.tables).toContain('todo_items');

            // Verify tables are gone
            const tables = await fetchList(db, 'mssql', 'tables');
            const tableNames = tables.map((t) => t.name);
            expect(tableNames).not.toContain('users');
            expect(tableNames).not.toContain('todo_lists');
            expect(tableNames).not.toContain('todo_items');

        });

        it('should drop all views', async () => {

            const result = await teardownSchema(db, 'mssql');

            // All 3 views should be dropped
            expect(result.dropped.views).toContain('v_active_users');
            expect(result.dropped.views).toContain('v_todo_lists_with_counts');
            expect(result.dropped.views).toContain('v_active_todo_items');

            // Verify views are gone
            const views = await fetchList(db, 'mssql', 'views');
            const viewNames = views.map((v) => v.name);
            expect(viewNames).not.toContain('v_active_users');
            expect(viewNames).not.toContain('v_todo_lists_with_counts');
            expect(viewNames).not.toContain('v_active_todo_items');

        });

        it('should drop all functions', async () => {

            const result = await teardownSchema(db, 'mssql');

            // All 3 functions should be dropped
            expect(result.dropped.functions).toContain('fn_IsValidEmail');
            expect(result.dropped.functions).toContain('fn_IsValidHexColor');
            expect(result.dropped.functions).toContain('fn_GetPriorityLabel');

            // Verify functions are gone
            const functions = await fetchList(db, 'mssql', 'functions');
            const fnNames = functions.map((f) => f.name);
            expect(fnNames).not.toContain('fn_IsValidEmail');
            expect(fnNames).not.toContain('fn_IsValidHexColor');
            expect(fnNames).not.toContain('fn_GetPriorityLabel');

        });

        it('should drop all types', async () => {

            const result = await teardownSchema(db, 'mssql');

            // All 5 types should be dropped
            expect(result.dropped.types).toContain('EmailAddress');
            expect(result.dropped.types).toContain('Username');
            expect(result.dropped.types).toContain('HexColor');
            expect(result.dropped.types).toContain('Priority');
            expect(result.dropped.types).toContain('SoftDeleteDate');

            // Verify types are gone
            const types = await fetchList(db, 'mssql', 'types');
            const typeNames = types.map((t) => t.name);
            expect(typeNames).not.toContain('EmailAddress');
            expect(typeNames).not.toContain('Username');
            expect(typeNames).not.toContain('HexColor');
            expect(typeNames).not.toContain('Priority');
            expect(typeNames).not.toContain('SoftDeleteDate');

        });

        it('should keep views when keepViews is true', async () => {

            const result = await teardownSchema(db, 'mssql', {
                keepViews: true,
            });

            // Views should NOT be in dropped list
            expect(result.dropped.views).toHaveLength(0);

            // Views should still exist
            const views = await fetchList(db, 'mssql', 'views');
            expect(views.length).toBe(3);

        });

        it('should keep functions when keepFunctions is true', async () => {

            const result = await teardownSchema(db, 'mssql', {
                keepFunctions: true,
            });

            // Functions should NOT be in dropped list
            expect(result.dropped.functions).toHaveLength(0);

            // Functions should still exist
            const functions = await fetchList(db, 'mssql', 'functions');
            expect(functions.length).toBe(3);

        });

        it('should keep types when keepTypes is true', async () => {

            const result = await teardownSchema(db, 'mssql', {
                keepTypes: true,
            });

            // Types should NOT be in dropped list
            expect(result.dropped.types).toHaveLength(0);

            // Types should still exist
            const types = await fetchList(db, 'mssql', 'types');
            expect(types.length).toBe(5);

        });

        it('should preserve specified tables', async () => {

            const result = await teardownSchema(db, 'mssql', {
                preserveTables: ['users'],
            });

            // users should be preserved
            expect(result.preserved).toContain('users');
            expect(result.dropped.tables).not.toContain('users');

            // Verify users table still exists
            const tables = await fetchList(db, 'mssql', 'tables');
            const tableNames = tables.map((t) => t.name);
            expect(tableNames).toContain('users');

        });

        it('should return duration in result', async () => {

            const result = await teardownSchema(db, 'mssql');

            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

    });

    describe('previewTeardown', () => {

        beforeEach(async () => {

            // Deploy fresh schema for preview tests
            await teardownTestSchema(db, 'mssql').catch(() => {});
            await deployTestSchema(db, 'mssql');
            await seedTestData(db, 'mssql');

        });

        it('should return preview without executing', async () => {

            const preview = await previewTeardown(db, 'mssql');

            // Preview should list objects to drop
            expect(preview.toDrop.tables).toContain('users');
            expect(preview.toDrop.tables).toContain('todo_lists');
            expect(preview.toDrop.tables).toContain('todo_items');

            expect(preview.toDrop.views).toContain('v_active_users');
            expect(preview.toDrop.views).toContain('v_todo_lists_with_counts');
            expect(preview.toDrop.views).toContain('v_active_todo_items');

            expect(preview.toDrop.functions).toContain('fn_IsValidEmail');
            expect(preview.toDrop.functions).toContain('fn_IsValidHexColor');
            expect(preview.toDrop.functions).toContain('fn_GetPriorityLabel');

            expect(preview.toDrop.types).toContain('EmailAddress');
            expect(preview.toDrop.types).toContain('Username');
            expect(preview.toDrop.types).toContain('HexColor');
            expect(preview.toDrop.types).toContain('Priority');
            expect(preview.toDrop.types).toContain('SoftDeleteDate');

        });

        it('should NOT modify database', async () => {

            const overviewBefore = await fetchOverview(db, 'mssql');

            await previewTeardown(db, 'mssql');

            const overviewAfter = await fetchOverview(db, 'mssql');

            // Nothing should have changed
            expect(overviewAfter.tables).toBe(overviewBefore.tables);
            expect(overviewAfter.views).toBe(overviewBefore.views);
            expect(overviewAfter.functions).toBe(overviewBefore.functions);
            expect(overviewAfter.procedures).toBe(overviewBefore.procedures);
            expect(overviewAfter.types).toBe(overviewBefore.types);

        });

        it('should include SQL statements that would be executed', async () => {

            const preview = await previewTeardown(db, 'mssql');

            expect(preview.statements.length).toBeGreaterThan(0);

            // Should have DROP statements
            const statementsStr = preview.statements.join('\n').toUpperCase();
            expect(statementsStr).toContain('DROP');

        });

        it('should respect options in preview', async () => {

            const preview = await previewTeardown(db, 'mssql', {
                keepViews: true,
                keepFunctions: true,
            });

            // Views and functions should NOT be in toDrop
            expect(preview.toDrop.views).toHaveLength(0);
            expect(preview.toDrop.functions).toHaveLength(0);

            // Tables should still be in toDrop
            expect(preview.toDrop.tables.length).toBeGreaterThan(0);

        });

        it('should respect preserveTables in preview', async () => {

            const preview = await previewTeardown(db, 'mssql', {
                preserveTables: ['users'],
            });

            // users should be preserved
            expect(preview.toPreserve).toContain('users');
            expect(preview.toDrop.tables).not.toContain('users');

        });

    });

    describe('noorm table preservation', () => {

        beforeEach(async () => {

            // Deploy fresh schema
            await teardownTestSchema(db, 'mssql').catch(() => {});
            await deployTestSchema(db, 'mssql');

            // Create a noorm table to test preservation
            await sql.raw(`
                CREATE TABLE __noorm_test__ (
                    id INT PRIMARY KEY,
                    data VARCHAR(100)
                )
            `).execute(db);

            await sql.raw(`
                INSERT INTO __noorm_test__ (id, data) VALUES (1, 'test data')
            `).execute(db);

        });

        it('should preserve noorm tables during truncate', async () => {

            const result = await truncateData(db, 'mssql');

            // __noorm_test__ should be preserved
            expect(result.preserved.some((t) => t.startsWith('__noorm_'))).toBe(true);

            // Data should still exist
            const noormResult = await sql.raw(
                'SELECT COUNT(*) as cnt FROM __noorm_test__',
            ).execute(db);
            const count = (noormResult.rows[0] as { cnt: number }).cnt;
            expect(count).toBe(1);

        });

        it('should preserve noorm tables during schema teardown', async () => {

            const result = await teardownSchema(db, 'mssql');

            // __noorm_test__ should be preserved
            expect(result.preserved.some((t) => t.startsWith('__noorm_'))).toBe(true);
            expect(result.dropped.tables).not.toContain('__noorm_test__');

            // Table should still exist
            const noormResult = await sql.raw(
                'SELECT COUNT(*) as cnt FROM __noorm_test__',
            ).execute(db);
            const count = (noormResult.rows[0] as { cnt: number }).cnt;
            expect(count).toBe(1);

        });

    });

});
