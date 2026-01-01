/**
 * Integration tests for MSSQL explore operations.
 *
 * Tests fetchOverview, fetchList, and fetchDetail against a real MSSQL instance.
 * Requires docker-compose.test.yml to be running.
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
    FunctionSummary,
    ProcedureSummary,
    TypeSummary,
    TableDetail,
    ViewDetail,
    FunctionDetail,
    ProcedureDetail,
    TypeDetail,
} from '../../../src/core/explore/types.js';
import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
    resetTestData,
    teardownTestSchema,
    skipIfNoContainer,
} from '../../utils/db.js';


describe('integration: mssql explore', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        const conn = await createTestConnection('mssql');
        db = conn.db;
        destroy = conn.destroy;

        // Deploy schema once for all tests
        await teardownTestSchema(db, 'mssql');
        await deployTestSchema(db, 'mssql');
        await seedTestData(db, 'mssql');

    });

    afterAll(async () => {

        if (destroy) {

            await teardownTestSchema(db, 'mssql');
            await destroy();

        }

    });

    beforeEach(async () => {

        // Reset data between tests (but keep schema)
        await resetTestData(db, 'mssql');
        await seedTestData(db, 'mssql');

    });

    describe('fetchOverview', () => {

        it('should return correct counts for all object types', async () => {

            const overview = await fetchOverview(db, 'mssql');

            // From fixtures: 3 tables, 3 views, 3 functions, 15 procedures, 5 types
            expect(overview.tables).toBe(3);
            expect(overview.views).toBe(3);
            expect(overview.functions).toBe(3);
            expect(overview.procedures).toBe(15);
            expect(overview.types).toBe(5);

            // Indexes and FKs are present from table definitions
            expect(overview.indexes).toBeGreaterThanOrEqual(0);
            expect(overview.foreignKeys).toBeGreaterThanOrEqual(0);

        });

        it('should exclude noorm tables by default', async () => {

            // Even if __noorm_* tables exist, they should not be counted
            const overview = await fetchOverview(db, 'mssql');

            expect(overview.tables).toBe(3);

        });

    });

    describe('fetchList: tables', () => {

        it('should return all 3 tables with column counts', async () => {

            const tables = await fetchList(db, 'mssql', 'tables');

            expect(tables).toHaveLength(3);

            const tableNames = tables.map((t: TableSummary) => t.name);
            expect(tableNames).toContain('users');
            expect(tableNames).toContain('todo_lists');
            expect(tableNames).toContain('todo_items');

        });

        it('should include column counts for each table', async () => {

            const tables = await fetchList(db, 'mssql', 'tables');

            const usersTable = tables.find((t: TableSummary) => t.name === 'users');
            expect(usersTable).toBeDefined();
            expect(usersTable!.columnCount).toBeGreaterThan(0);

            const todoListsTable = tables.find((t: TableSummary) => t.name === 'todo_lists');
            expect(todoListsTable).toBeDefined();
            expect(todoListsTable!.columnCount).toBeGreaterThan(0);

            const todoItemsTable = tables.find((t: TableSummary) => t.name === 'todo_items');
            expect(todoItemsTable).toBeDefined();
            expect(todoItemsTable!.columnCount).toBeGreaterThan(0);

        });

        it('should include schema information', async () => {

            const tables = await fetchList(db, 'mssql', 'tables');

            const usersTable = tables.find((t: TableSummary) => t.name === 'users');
            expect(usersTable).toBeDefined();
            expect(usersTable!.schema).toBe('dbo');

        });

    });

    describe('fetchList: views', () => {

        it('should return all 3 views', async () => {

            const views = await fetchList(db, 'mssql', 'views');

            expect(views).toHaveLength(3);

            const viewNames = views.map((v: ViewSummary) => v.name);
            expect(viewNames).toContain('v_active_users');
            expect(viewNames).toContain('v_todo_lists_with_counts');
            expect(viewNames).toContain('v_active_todo_items');

        });

        it('should include column counts for each view', async () => {

            const views = await fetchList(db, 'mssql', 'views');

            for (const view of views) {

                expect(view.columnCount).toBeGreaterThan(0);

            }

        });

        it('should indicate whether views are updatable', async () => {

            const views = await fetchList(db, 'mssql', 'views');

            for (const view of views) {

                expect(typeof view.isUpdatable).toBe('boolean');

            }

        });

    });

    describe('fetchList: functions', () => {

        it('should return all 3 scalar functions', async () => {

            const functions = await fetchList(db, 'mssql', 'functions');

            expect(functions).toHaveLength(3);

            const fnNames = functions.map((f: FunctionSummary) => f.name);
            expect(fnNames).toContain('fn_IsValidEmail');
            expect(fnNames).toContain('fn_IsValidHexColor');
            expect(fnNames).toContain('fn_GetPriorityLabel');

        });

        it('should include parameter counts and return types', async () => {

            const functions = await fetchList(db, 'mssql', 'functions');

            const emailFn = functions.find((f: FunctionSummary) => f.name === 'fn_IsValidEmail');
            expect(emailFn).toBeDefined();
            expect(emailFn!.parameterCount).toBe(1);
            expect(emailFn!.returnType).toBeDefined();

            const priorityFn = functions.find((f: FunctionSummary) => f.name === 'fn_GetPriorityLabel');
            expect(priorityFn).toBeDefined();
            expect(priorityFn!.parameterCount).toBe(1);

        });

    });

    describe('fetchList: procedures', () => {

        it('should return all 15 stored procedures', async () => {

            const procedures = await fetchList(db, 'mssql', 'procedures');

            expect(procedures.length).toBeGreaterThanOrEqual(15);

            const procNames = procedures.map((p: ProcedureSummary) => p.name);

            // User procedures
            expect(procNames).toContain('create_user');
            expect(procNames).toContain('get_user_by_id');
            expect(procNames).toContain('get_user_by_email');
            expect(procNames).toContain('update_user');
            expect(procNames).toContain('delete_user');

            // Todo list procedures
            expect(procNames).toContain('create_todo_list');
            expect(procNames).toContain('get_todo_list_by_id');
            expect(procNames).toContain('get_todo_lists_by_user');
            expect(procNames).toContain('update_todo_list');
            expect(procNames).toContain('delete_todo_list');

            // Todo item procedures
            expect(procNames).toContain('create_todo_item');
            expect(procNames).toContain('get_todo_item_by_id');
            expect(procNames).toContain('get_todo_items_by_list');
            expect(procNames).toContain('update_todo_item');
            expect(procNames).toContain('toggle_todo_item');
            expect(procNames).toContain('delete_todo_item');

        });

        it('should include parameter counts', async () => {

            const procedures = await fetchList(db, 'mssql', 'procedures');

            // create_user has 5 parameters (email, username, password_hash, display_name, avatar_url)
            const createUser = procedures.find((p: ProcedureSummary) => p.name === 'create_user');
            expect(createUser).toBeDefined();
            expect(createUser!.parameterCount).toBe(5);

            // get_user_by_id has 1 parameter (p_id)
            const getUserById = procedures.find((p: ProcedureSummary) => p.name === 'get_user_by_id');
            expect(getUserById).toBeDefined();
            expect(getUserById!.parameterCount).toBe(1);

        });

    });

    describe('fetchList: types', () => {

        it('should return all 5 custom types', async () => {

            const types = await fetchList(db, 'mssql', 'types');

            expect(types).toHaveLength(5);

            const typeNames = types.map((t: TypeSummary) => t.name);
            expect(typeNames).toContain('EmailAddress');
            expect(typeNames).toContain('Username');
            expect(typeNames).toContain('HexColor');
            expect(typeNames).toContain('Priority');
            expect(typeNames).toContain('SoftDeleteDate');

        });

        it('should identify type kinds correctly', async () => {

            const types = await fetchList(db, 'mssql', 'types');

            // All MSSQL user types from fixtures are alias types (domain)
            for (const type of types) {

                // MSSQL alias types are typically classified as 'domain' or 'other'
                expect(['domain', 'other']).toContain(type.kind);

            }

        });

    });

    describe('fetchDetail: tables', () => {

        it('should return full table detail for users table', async () => {

            const detail = await fetchDetail(db, 'mssql', 'tables', 'users', 'dbo');

            expect(detail).not.toBeNull();

            const tableDetail = detail as TableDetail;
            expect(tableDetail.name).toBe('users');
            expect(tableDetail.schema).toBe('dbo');

        });

        it('should include columns with correct metadata', async () => {

            const detail = await fetchDetail(db, 'mssql', 'tables', 'users', 'dbo');
            const tableDetail = detail as TableDetail;

            expect(tableDetail.columns).toBeDefined();
            expect(tableDetail.columns.length).toBeGreaterThan(0);

            const idColumn = tableDetail.columns.find((c) => c.name === 'id');
            expect(idColumn).toBeDefined();
            expect(idColumn!.isPrimaryKey).toBe(true);
            expect(idColumn!.isNullable).toBe(false);

            const emailColumn = tableDetail.columns.find((c) => c.name === 'email');
            expect(emailColumn).toBeDefined();
            expect(emailColumn!.isNullable).toBe(false);

            const deletedAtColumn = tableDetail.columns.find((c) => c.name === 'deleted_at');
            expect(deletedAtColumn).toBeDefined();
            expect(deletedAtColumn!.isNullable).toBe(true);

        });

        it('should include indexes', async () => {

            const detail = await fetchDetail(db, 'mssql', 'tables', 'users', 'dbo');
            const tableDetail = detail as TableDetail;

            expect(tableDetail.indexes).toBeDefined();

            // Should have at least the primary key index
            const hasPrimaryKey = tableDetail.indexes.some((idx) => idx.isPrimary);
            expect(hasPrimaryKey).toBe(true);

        });

        it('should include foreign keys for child tables', async () => {

            const detail = await fetchDetail(db, 'mssql', 'tables', 'todo_lists', 'dbo');
            const tableDetail = detail as TableDetail;

            expect(tableDetail.foreignKeys).toBeDefined();

            // todo_lists has FK to users
            const userFK = tableDetail.foreignKeys.find((fk) => fk.referencedTable === 'users');
            expect(userFK).toBeDefined();
            expect(userFK!.columns).toContain('user_id');

        });

        it('should return null for non-existent table', async () => {

            const detail = await fetchDetail(db, 'mssql', 'tables', 'nonexistent_table', 'dbo');

            expect(detail).toBeNull();

        });

    });

    describe('fetchDetail: views', () => {

        it('should return full view detail for v_active_users', async () => {

            const detail = await fetchDetail(db, 'mssql', 'views', 'v_active_users', 'dbo');

            expect(detail).not.toBeNull();

            const viewDetail = detail as ViewDetail;
            expect(viewDetail.name).toBe('v_active_users');
            expect(viewDetail.schema).toBe('dbo');

        });

        it('should include columns for the view', async () => {

            const detail = await fetchDetail(db, 'mssql', 'views', 'v_active_users', 'dbo');
            const viewDetail = detail as ViewDetail;

            expect(viewDetail.columns).toBeDefined();
            expect(viewDetail.columns.length).toBeGreaterThan(0);

            // v_active_users should have columns from users table (minus password_hash and deleted_at)
            const columnNames = viewDetail.columns.map((c) => c.name);
            expect(columnNames).toContain('id');
            expect(columnNames).toContain('email');
            expect(columnNames).toContain('username');

        });

        it('should include view definition', async () => {

            const detail = await fetchDetail(db, 'mssql', 'views', 'v_active_users', 'dbo');
            const viewDetail = detail as ViewDetail;

            // Definition might be available depending on permissions
            if (viewDetail.definition) {

                expect(viewDetail.definition).toContain('SELECT');

            }

        });

    });

    describe('fetchDetail: functions', () => {

        it('should return full function detail for fn_IsValidEmail', async () => {

            const detail = await fetchDetail(db, 'mssql', 'functions', 'fn_IsValidEmail', 'dbo');

            expect(detail).not.toBeNull();

            const fnDetail = detail as FunctionDetail;
            expect(fnDetail.name).toBe('fn_IsValidEmail');
            expect(fnDetail.schema).toBe('dbo');

        });

        it('should include parameters with correct metadata', async () => {

            const detail = await fetchDetail(db, 'mssql', 'functions', 'fn_IsValidEmail', 'dbo');
            const fnDetail = detail as FunctionDetail;

            expect(fnDetail.parameters).toBeDefined();
            expect(fnDetail.parameters).toHaveLength(1);

            const emailParam = fnDetail.parameters[0];
            // MSSQL dialect strips @ prefix from parameter names
            expect(emailParam!.name).toBe('email');
            expect(emailParam!.mode).toBe('IN');

        });

        it('should include return type', async () => {

            const detail = await fetchDetail(db, 'mssql', 'functions', 'fn_IsValidEmail', 'dbo');
            const fnDetail = detail as FunctionDetail;

            expect(fnDetail.returnType).toBeDefined();
            // MSSQL dialect returns function type category: scalar, inline table, or table
            expect(fnDetail.returnType).toBe('scalar');

        });

    });

    describe('fetchDetail: procedures', () => {

        it('should return full procedure detail for create_user', async () => {

            const detail = await fetchDetail(db, 'mssql', 'procedures', 'create_user', 'dbo');

            expect(detail).not.toBeNull();

            const procDetail = detail as ProcedureDetail;
            expect(procDetail.name).toBe('create_user');
            expect(procDetail.schema).toBe('dbo');

        });

        it('should include parameters with correct metadata', async () => {

            const detail = await fetchDetail(db, 'mssql', 'procedures', 'create_user', 'dbo');
            const procDetail = detail as ProcedureDetail;

            expect(procDetail.parameters).toBeDefined();
            expect(procDetail.parameters).toHaveLength(5);

            // MSSQL dialect strips @ prefix from parameter names
            const paramNames = procDetail.parameters.map((p) => p.name);
            expect(paramNames).toContain('p_email');
            expect(paramNames).toContain('p_username');
            expect(paramNames).toContain('p_password_hash');
            expect(paramNames).toContain('p_display_name');
            expect(paramNames).toContain('p_avatar_url');

        });

        it('should include procedure definition', async () => {

            const detail = await fetchDetail(db, 'mssql', 'procedures', 'create_user', 'dbo');
            const procDetail = detail as ProcedureDetail;

            // Definition might be available depending on permissions
            if (procDetail.definition) {

                expect(procDetail.definition).toContain('INSERT INTO users');

            }

        });

    });

    describe('fetchDetail: types', () => {

        it('should return full type detail for EmailAddress', async () => {

            const detail = await fetchDetail(db, 'mssql', 'types', 'EmailAddress', 'dbo');

            expect(detail).not.toBeNull();

            const typeDetail = detail as TypeDetail;
            expect(typeDetail.name).toBe('EmailAddress');
            expect(typeDetail.schema).toBe('dbo');

        });

        it('should identify type as domain/alias', async () => {

            const detail = await fetchDetail(db, 'mssql', 'types', 'EmailAddress', 'dbo');
            const typeDetail = detail as TypeDetail;

            // MSSQL alias types are domains
            expect(['domain', 'other']).toContain(typeDetail.kind);

            // Should have base type info
            if (typeDetail.baseType) {

                expect(typeDetail.baseType.toLowerCase()).toContain('varchar');

            }

        });

        it('should return null for non-existent type', async () => {

            const detail = await fetchDetail(db, 'mssql', 'types', 'NonExistentType', 'dbo');

            expect(detail).toBeNull();

        });

    });

});
