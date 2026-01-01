/**
 * MySQL Explore Integration Tests.
 *
 * Tests explore operations against a real MySQL database.
 * Requires MySQL container running on port 13306.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';

import {
    fetchOverview,
    fetchList,
    fetchDetail,
} from '../../../src/core/explore/index.js';
import type {
    TableSummary,
    ViewSummary,
    ProcedureSummary,
    TableDetail,
    ViewDetail,
    ProcedureDetail,
} from '../../../src/core/explore/types.js';
import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
    resetTestData,
    teardownTestSchema,
    skipIfNoContainer,
} from '../../utils/db.js';

describe('integration: mysql explore', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('mysql');

        const conn = await createTestConnection('mysql');
        db = conn.db;
        destroy = conn.destroy;

        // Clean slate
        await teardownTestSchema(db, 'mysql');
        await deployTestSchema(db, 'mysql');
        await seedTestData(db, 'mysql');

    });

    afterAll(async () => {

        if (destroy) {

            await teardownTestSchema(db, 'mysql');
            await destroy();

        }

    });

    beforeEach(async () => {

        await resetTestData(db, 'mysql');
        await seedTestData(db, 'mysql');

    });

    describe('fetchOverview', () => {

        it('should return correct counts for all object types', async () => {

            const overview = await fetchOverview(db, 'mysql');

            expect(overview.tables).toBe(3);
            expect(overview.views).toBe(3);
            expect(overview.functions).toBe(0);
            expect(overview.procedures).toBe(15);
            expect(overview.types).toBe(0);

        });

        it('should exclude noorm tables by default', async () => {

            const overview = await fetchOverview(db, 'mysql');

            // Should only count user tables, not __noorm_* tables
            expect(overview.tables).toBe(3);

        });

        it('should include noorm tables when option is set', async () => {

            const overview = await fetchOverview(db, 'mysql', {
                includeNoormTables: true,
            });

            // When including noorm tables, the count may be higher
            expect(overview.tables).toBeGreaterThanOrEqual(3);

        });

    });

    describe('fetchList', () => {

        describe('tables', () => {

            it('should return all 3 tables', async () => {

                const tables = await fetchList(db, 'mysql', 'tables');

                expect(tables).toHaveLength(3);

                const tableNames = tables.map((t: TableSummary) => t.name).sort();
                expect(tableNames).toEqual(['todo_items', 'todo_lists', 'users']);

            });

            it('should include column count for each table', async () => {

                const tables = await fetchList(db, 'mysql', 'tables');

                const usersTable = tables.find((t: TableSummary) => t.name === 'users');
                expect(usersTable).toBeDefined();
                expect(usersTable!.columnCount).toBeGreaterThanOrEqual(8);

                const todoListsTable = tables.find((t: TableSummary) => t.name === 'todo_lists');
                expect(todoListsTable).toBeDefined();
                expect(todoListsTable!.columnCount).toBeGreaterThanOrEqual(8);

                const todoItemsTable = tables.find((t: TableSummary) => t.name === 'todo_items');
                expect(todoItemsTable).toBeDefined();
                expect(todoItemsTable!.columnCount).toBeGreaterThanOrEqual(11);

            });

            it('should exclude noorm tables by default', async () => {

                const tables = await fetchList(db, 'mysql', 'tables');

                const noormTables = tables.filter((t: TableSummary) =>
                    t.name.startsWith('__noorm_'),
                );
                expect(noormTables).toHaveLength(0);

            });

        });

        describe('views', () => {

            it('should return all 3 views', async () => {

                const views = await fetchList(db, 'mysql', 'views');

                expect(views).toHaveLength(3);

                const viewNames = views.map((v: ViewSummary) => v.name).sort();
                expect(viewNames).toEqual([
                    'v_active_todo_items',
                    'v_active_users',
                    'v_todo_lists_with_counts',
                ]);

            });

            it('should include column count for each view', async () => {

                const views = await fetchList(db, 'mysql', 'views');

                for (const view of views) {

                    expect((view as ViewSummary).columnCount).toBeGreaterThan(0);

                }

            });

        });

        describe('procedures', () => {

            it('should return all 15 procedures', async () => {

                const procedures = await fetchList(db, 'mysql', 'procedures');

                // MySQL test schema has 15 procedures (not functions)
                expect(procedures.length).toBe(15);

            });

            it('should include procedure names from fixture', async () => {

                const procedures = await fetchList(db, 'mysql', 'procedures');

                const procNames = procedures.map((p: ProcedureSummary) => p.name);

                // Verify some expected procedure names exist
                expect(procNames).toContain('create_user');
                expect(procNames).toContain('get_user_by_id');
                expect(procNames).toContain('update_user');
                expect(procNames).toContain('delete_user');
                expect(procNames).toContain('create_todo_list');
                expect(procNames).toContain('create_todo_item');
                expect(procNames).toContain('toggle_todo_item');

            });

            it('should include parameter count for procedures', async () => {

                const procedures = await fetchList(db, 'mysql', 'procedures');

                const createUser = procedures.find(
                    (p: ProcedureSummary) => p.name === 'create_user',
                );
                expect(createUser).toBeDefined();
                expect(createUser!.parameterCount).toBe(5);

                const getUserById = procedures.find(
                    (p: ProcedureSummary) => p.name === 'get_user_by_id',
                );
                expect(getUserById).toBeDefined();
                expect(getUserById!.parameterCount).toBe(1);

            });

        });

        describe('functions', () => {

            it('should return 0 functions (MySQL uses procedures)', async () => {

                const functions = await fetchList(db, 'mysql', 'functions');

                expect(functions).toHaveLength(0);

            });

        });

        describe('indexes', () => {

            it('should return indexes for all tables', async () => {

                const indexes = await fetchList(db, 'mysql', 'indexes');

                // Should have multiple indexes (primary keys + named indexes)
                expect(indexes.length).toBeGreaterThan(0);

            });

            it('should identify primary key indexes', async () => {

                const indexes = await fetchList(db, 'mysql', 'indexes');

                const primaryIndexes = indexes.filter((i) => i.isPrimary);
                expect(primaryIndexes.length).toBeGreaterThanOrEqual(3);

            });

        });

        describe('foreignKeys', () => {

            it('should return foreign key relationships', async () => {

                const foreignKeys = await fetchList(db, 'mysql', 'foreignKeys');

                // todo_lists -> users, todo_items -> todo_lists
                expect(foreignKeys.length).toBeGreaterThanOrEqual(2);

            });

            it('should identify correct table references', async () => {

                const foreignKeys = await fetchList(db, 'mysql', 'foreignKeys');

                const todoListsFk = foreignKeys.find((fk) =>
                    fk.tableName === 'todo_lists' && fk.referencedTable === 'users',
                );
                expect(todoListsFk).toBeDefined();

                const todoItemsFk = foreignKeys.find((fk) =>
                    fk.tableName === 'todo_items' && fk.referencedTable === 'todo_lists',
                );
                expect(todoItemsFk).toBeDefined();

            });

        });

    });

    describe('fetchDetail', () => {

        describe('tables', () => {

            it('should return full detail for users table', async () => {

                const detail = await fetchDetail(db, 'mysql', 'tables', 'users');

                expect(detail).not.toBeNull();
                expect(detail!.name).toBe('users');

            });

            it('should include columns with correct types', async () => {

                const detail = await fetchDetail(
                    db, 'mysql', 'tables', 'users',
                ) as TableDetail;

                expect(detail.columns).toBeDefined();
                expect(detail.columns.length).toBeGreaterThanOrEqual(8);

                const idCol = detail.columns.find((c) => c.name === 'id');
                expect(idCol).toBeDefined();
                expect(idCol!.isPrimaryKey).toBe(true);

                const emailCol = detail.columns.find((c) => c.name === 'email');
                expect(emailCol).toBeDefined();
                expect(emailCol!.isNullable).toBe(false);

            });

            it('should include indexes for table', async () => {

                const detail = await fetchDetail(
                    db, 'mysql', 'tables', 'users',
                ) as TableDetail;

                expect(detail.indexes).toBeDefined();
                expect(detail.indexes.length).toBeGreaterThan(0);

                // Should have primary key index
                const pkIndex = detail.indexes.find((i) => i.isPrimary);
                expect(pkIndex).toBeDefined();

            });

            it('should include foreign keys for table', async () => {

                const detail = await fetchDetail(
                    db, 'mysql', 'tables', 'todo_lists',
                ) as TableDetail;

                expect(detail.foreignKeys).toBeDefined();
                expect(detail.foreignKeys.length).toBeGreaterThanOrEqual(1);

                const userFk = detail.foreignKeys.find(
                    (fk) => fk.referencedTable === 'users',
                );
                expect(userFk).toBeDefined();

            });

            it('should return null for non-existent table', async () => {

                const detail = await fetchDetail(
                    db, 'mysql', 'tables', 'nonexistent_table',
                );

                expect(detail).toBeNull();

            });

        });

        describe('views', () => {

            it('should return full detail for view', async () => {

                const detail = await fetchDetail(
                    db, 'mysql', 'views', 'v_active_users',
                ) as ViewDetail;

                expect(detail).not.toBeNull();
                expect(detail.name).toBe('v_active_users');
                expect(detail.columns).toBeDefined();
                expect(detail.columns.length).toBeGreaterThan(0);

            });

            it('should include view definition when available', async () => {

                const detail = await fetchDetail(
                    db, 'mysql', 'views', 'v_active_users',
                ) as ViewDetail;

                // MySQL should provide view definition
                if (detail.definition) {

                    expect(detail.definition.toLowerCase()).toContain('select');

                }

            });

            it('should return null for non-existent view', async () => {

                const detail = await fetchDetail(
                    db, 'mysql', 'views', 'nonexistent_view',
                );

                expect(detail).toBeNull();

            });

        });

        describe('procedures', () => {

            it('should return full detail for procedure', async () => {

                const detail = await fetchDetail(
                    db, 'mysql', 'procedures', 'create_user',
                ) as ProcedureDetail;

                expect(detail).not.toBeNull();
                expect(detail.name).toBe('create_user');

            });

            it('should include parameters with correct details', async () => {

                const detail = await fetchDetail(
                    db, 'mysql', 'procedures', 'create_user',
                ) as ProcedureDetail;

                expect(detail.parameters).toBeDefined();
                expect(detail.parameters.length).toBe(5);

                // Verify parameter structure
                const emailParam = detail.parameters.find((p) => p.name === 'p_email');
                expect(emailParam).toBeDefined();
                expect(emailParam!.mode).toBe('IN');

            });

            it('should include procedure definition when available', async () => {

                const detail = await fetchDetail(
                    db, 'mysql', 'procedures', 'create_user',
                ) as ProcedureDetail;

                // MySQL should provide procedure definition
                if (detail.definition) {

                    expect(detail.definition.toLowerCase()).toContain('insert');

                }

            });

            it('should return null for non-existent procedure', async () => {

                const detail = await fetchDetail(
                    db, 'mysql', 'procedures', 'nonexistent_proc',
                );

                expect(detail).toBeNull();

            });

        });

    });

});
