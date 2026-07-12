/**
 * Integration tests for MSSQL teardown operations.
 *
 * Tests truncateData, teardownSchema, and previewTeardown against a real MSSQL instance.
 * Requires docker-compose.test.yml to be running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { sql, type Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';

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

    }, 30_000);

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

        it('should drop all functions including TVFs', async () => {

            const result = await teardownSchema(db, 'mssql');

            // All 3 scalar functions should be dropped
            expect(result.dropped.functions).toContain('fn_IsValidEmail');
            expect(result.dropped.functions).toContain('fn_IsValidHexColor');
            expect(result.dropped.functions).toContain('fn_GetPriorityLabel');

            // All 3 TVFs should be dropped
            expect(result.dropped.functions).toContain('fn_GetTodoItemsByList');
            expect(result.dropped.functions).toContain('fn_GetTodoListsByUser');
            expect(result.dropped.functions).toContain('fn_GetActiveUsers');

            // Verify all functions are gone
            const functions = await fetchList(db, 'mssql', 'functions');
            expect(functions).toHaveLength(0);

        });

        it('should drop all types including TVPs that reference scalar types', async () => {

            const result = await teardownSchema(db, 'mssql');

            // All 5 scalar types should be dropped
            expect(result.dropped.types).toContain('EmailAddress');
            expect(result.dropped.types).toContain('Username');
            expect(result.dropped.types).toContain('HexColor');
            expect(result.dropped.types).toContain('Priority');
            expect(result.dropped.types).toContain('SoftDeleteDate');

            // TVPs (table types) should also be dropped
            expect(result.dropped.types).toContain('UserBatchInsert');
            expect(result.dropped.types).toContain('TodoItemBatch');

            // Verify all types are gone
            const types = await fetchList(db, 'mssql', 'types');
            const typeNames = types.map((t) => t.name);
            expect(typeNames).not.toContain('EmailAddress');
            expect(typeNames).not.toContain('Username');
            expect(typeNames).not.toContain('HexColor');
            expect(typeNames).not.toContain('Priority');
            expect(typeNames).not.toContain('SoftDeleteDate');
            expect(typeNames).not.toContain('UserBatchInsert');
            expect(typeNames).not.toContain('TodoItemBatch');

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

            // Functions should still exist (4 scalar + 4 TVFs)
            const functions = await fetchList(db, 'mssql', 'functions');
            expect(functions.length).toBe(8);

            // MSSQL: types are also kept — functions → TVPs → scalar types
            // dependency chain can't be broken without CASCADE
            expect(result.dropped.types).toHaveLength(0);

        });

        it('should keep types when keepTypes is true', async () => {

            const result = await teardownSchema(db, 'mssql', {
                keepTypes: true,
            });

            // Types should NOT be in dropped list
            expect(result.dropped.types).toHaveLength(0);

            // Types should still exist (5 scalar + 2 TVPs)
            const types = await fetchList(db, 'mssql', 'types');
            expect(types.length).toBe(7);

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
            expect(preview.toDrop.types).toContain('UserBatchInsert');
            expect(preview.toDrop.types).toContain('TodoItemBatch');

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

            // Drop any existing test table first (teardownSchema preserves __noorm_* tables)
            await sql.raw('DROP TABLE IF EXISTS __noorm_test__').execute(db);

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

    // ─────────────────────────────────────────────────────────────
    // M-5: schema-bound UDFs must not block table drops.
    // M-6: truncate must not deadlock (canary: 5 sequential iterations).
    // ─────────────────────────────────────────────────────────────

    describe('teardownSchema with schema-bound UDF (M-5)', () => {

        beforeEach(async () => {

            await teardownTestSchema(db, 'mssql').catch(() => {});

        });

        it('drops a schema-bound UDF referencing a table without "is being referenced" errors', async () => {

            await sql.raw(`
                CREATE TABLE Memory (
                    id INT PRIMARY KEY,
                    score INT NOT NULL,
                    confidence INT NOT NULL
                )
            `).execute(db);

            // Schema-bound UDF — holds a dependency lock on Memory.score.
            // Pre-fix, this would cause teardownSchema to fail when DROP TABLE
            // ran before DROP FUNCTION.
            await sql.raw(`
                CREATE FUNCTION dbo.fn_MemoryScore(@id INT)
                RETURNS INT
                WITH SCHEMABINDING
                AS
                BEGIN
                    DECLARE @s INT;
                    SELECT @s = score FROM dbo.Memory WHERE id = @id;
                    RETURN @s;
                END
            `).execute(db);

            const result = await teardownSchema(db, 'mssql');

            expect(result.dropped.tables).toContain('Memory');
            expect(result.dropped.functions).toContain('fn_MemoryScore');

            // Both objects should be gone.
            const tables = await fetchList(db, 'mssql', 'tables');
            expect(tables.map((t) => t.name)).not.toContain('Memory');
            const functions = await fetchList(db, 'mssql', 'functions');
            expect(functions.map((f) => f.name)).not.toContain('fn_MemoryScore');

        });

    });

    describe('teardownSchema with CHECK-constraint UDF (issue #36)', () => {

        beforeEach(async () => {

            await teardownTestSchema(db, 'mssql').catch(() => {});

        });

        it('drops a table whose CHECK constraint references a scalar UDF without error 3729', async () => {

            // Scalar UDF referenced by a CHECK constraint — the canonical
            // base/subtype "IsType" pattern. Pre-fix, teardown dropped the
            // function before the table and failed with:
            //   Cannot DROP FUNCTION 'dbo.IsPositive_fn' because it is being
            //   referenced by object 'Thing_IsPositive'. (3729)
            await sql.raw(`
                CREATE FUNCTION dbo.IsPositive_fn(@n INT) RETURNS BIT
                AS BEGIN RETURN IIF(@n > 0, 1, 0) END
            `).execute(db);

            await sql.raw(`
                CREATE TABLE dbo.Thing (
                    Id INT PRIMARY KEY,
                    Qty INT NOT NULL,
                    CONSTRAINT Thing_IsPositive CHECK (dbo.IsPositive_fn(Qty) = 1)
                )
            `).execute(db);

            const result = await teardownSchema(db, 'mssql');

            expect(result.dropped.tables).toContain('Thing');
            expect(result.dropped.functions).toContain('IsPositive_fn');

            // Both objects should be gone.
            const tables = await fetchList(db, 'mssql', 'tables');
            expect(tables.map((t) => t.name)).not.toContain('Thing');
            const functions = await fetchList(db, 'mssql', 'functions');
            expect(functions.map((f) => f.name)).not.toContain('IsPositive_fn');

        });

    });

    describe('truncateData deadlock canary (M-6)', () => {

        beforeEach(async () => {

            await teardownTestSchema(db, 'mssql').catch(() => {});
            await deployTestSchema(db, 'mssql');

        });

        it('runs 5 sequential truncates without deadlock and never emits sp_MSforeachtable', async () => {

            for (let i = 0; i < 5; i++) {

                // Re-seed before each iteration so DELETEs actually have rows.
                await seedTestData(db, 'mssql');

                const result = await truncateData(db, 'mssql');

                // Regression guard: no sp_MSforeachtable in emitted SQL.
                const flat = result.statements.join('\n');
                expect(flat).not.toContain('sp_MSforeachtable');

                // Per-table NOCHECK/CHECK markers must appear.
                expect(flat).toContain('NOCHECK CONSTRAINT ALL');
                expect(flat).toContain('CHECK CONSTRAINT ALL');

                // All non-noorm rows are gone.
                const usersCnt = await sql.raw('SELECT COUNT(*) as cnt FROM users').execute(db);
                expect((usersCnt.rows[0] as { cnt: number }).cnt).toBe(0);

            }

        }, 60_000);

    });

    // ─────────────────────────────────────────────────────────────
    // v1-03: FK re-enable guarantee — a mid-truncate failure must never
    // leave FK enforcement off. An AFTER DELETE trigger on one user table
    // simulates the failure (e.g. a business-rule trigger blocking a
    // delete); truncateData must still throw the injected error AND
    // leave every FK constraint enabled afterward.
    // ─────────────────────────────────────────────────────────────

    describe('truncateData mid-truncate failure (v1-03 FK re-enable guarantee)', () => {

        beforeEach(async () => {

            await teardownTestSchema(db, 'mssql').catch(() => {});
            await deployTestSchema(db, 'mssql');
            await seedTestData(db, 'mssql');

            await sql.raw(`
                CREATE TRIGGER trg_block_delete ON todo_lists
                AFTER DELETE
                AS BEGIN
                    THROW 50000, 'injected mid-truncate failure', 1;
                END
            `).execute(db);

        });

        afterEach(async () => {

            await sql.raw('DROP TRIGGER IF EXISTS trg_block_delete').execute(db);

        });

        it('re-enables FK checks even when a mid-truncate DELETE throws, and re-surfaces the injected error', async () => {

            const [, err] = await attempt(() => truncateData(db, 'mssql'));

            expect(err).toBeInstanceOf(Error);
            expect(err?.message).toContain('injected mid-truncate failure');

            const disabledFks = await sql.raw(
                'SELECT COUNT(*) as cnt FROM sys.foreign_keys WHERE is_disabled = 1',
            ).execute(db);
            const cnt = (disabledFks.rows[0] as { cnt: number }).cnt;

            expect(cnt).toBe(0);

        });

    });

});
