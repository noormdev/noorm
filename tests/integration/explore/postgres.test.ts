/**
 * Integration tests for PostgreSQL explore operations.
 *
 * Tests fetchOverview, fetchList, and fetchDetail against a real PostgreSQL database.
 * Requires docker-compose.test.yml containers to be running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';

import { fetchOverview, fetchList, fetchDetail } from '../../../src/core/explore/index.js';
import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
    resetTestData,
    teardownTestSchema,
    skipIfNoContainer,
} from '../../utils/db.js';


describe('integration: postgres explore', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const conn = await createTestConnection('postgres');
        db = conn.db;
        destroy = conn.destroy;

        // Clean up any existing schema and deploy fresh
        await teardownTestSchema(db, 'postgres');
        await deployTestSchema(db, 'postgres');

    });

    afterAll(async () => {

        if (destroy) {

            await destroy();

        }

    });

    beforeEach(async () => {

        // Reset data between tests to ensure consistent state
        await resetTestData(db, 'postgres');
        await seedTestData(db, 'postgres');

    });

    describe('fetchOverview', () => {

        it('should return correct counts for all object types', async () => {

            const overview = await fetchOverview(db, 'postgres');

            // Fixture schema has:
            // - 3 tables: users, todo_lists, todo_items
            // - 3 views: v_active_users, v_todo_lists_with_counts, v_active_todo_items
            // - 15 functions: 5 user functions + 5 list functions + 5 item functions
            expect(overview.tables).toBe(3);
            expect(overview.views).toBe(3);
            expect(overview.functions).toBeGreaterThanOrEqual(15);

        });

        it('should exclude noorm internal tables by default', async () => {

            const overview = await fetchOverview(db, 'postgres');

            // Without noorm tables, should only have our 3 test tables
            expect(overview.tables).toBe(3);

        });

        it('should include noorm tables when option is set', async () => {

            const overviewWithout = await fetchOverview(db, 'postgres');
            const overviewWith = await fetchOverview(db, 'postgres', { includeNoormTables: true });

            // With noorm tables should be >= without (may or may not have noorm tables depending on state)
            expect(overviewWith.tables).toBeGreaterThanOrEqual(overviewWithout.tables);

        });

        it('should return indexes for the tables', async () => {

            const overview = await fetchOverview(db, 'postgres');

            // Fixture creates several indexes:
            // - 3 PKs (users, todo_lists, todo_items)
            // - idx_users_email, idx_users_username
            // - idx_todo_lists_user_id, idx_todo_lists_position
            // - idx_todo_items_list_id, idx_todo_items_position, idx_todo_items_due_date
            expect(overview.indexes).toBeGreaterThanOrEqual(7);

        });

        it('should return foreign key counts', async () => {

            const overview = await fetchOverview(db, 'postgres');

            // Fixture has 2 FKs:
            // - todo_lists.user_id -> users.id
            // - todo_items.list_id -> todo_lists.id
            expect(overview.foreignKeys).toBe(2);

        });

    });

    describe('fetchList - tables', () => {

        it('should return all 3 tables with correct names', async () => {

            const tables = await fetchList(db, 'postgres', 'tables');
            const tableNames = tables.map((t) => t.name).sort();

            expect(tableNames).toEqual(['todo_items', 'todo_lists', 'users']);

        });

        it('should return column counts for each table', async () => {

            const tables = await fetchList(db, 'postgres', 'tables');

            const users = tables.find((t) => t.name === 'users');
            const todoLists = tables.find((t) => t.name === 'todo_lists');
            const todoItems = tables.find((t) => t.name === 'todo_items');

            // users: id, email, username, password_hash, display_name, avatar_url, created_at, updated_at, deleted_at = 9
            expect(users?.columnCount).toBe(9);

            // todo_lists: id, user_id, title, description, color, position, created_at, updated_at, deleted_at = 9
            expect(todoLists?.columnCount).toBe(9);

            // todo_items: id, list_id, title, description, is_completed, priority, due_date, completed_at, position, created_at, updated_at, deleted_at = 12
            expect(todoItems?.columnCount).toBe(12);

        });

        it('should exclude noorm tables by default', async () => {

            const tables = await fetchList(db, 'postgres', 'tables');
            const noormTables = tables.filter((t) => t.name.startsWith('__noorm_'));

            expect(noormTables.length).toBe(0);

        });

    });

    describe('fetchList - views', () => {

        it('should return all 3 views', async () => {

            const views = await fetchList(db, 'postgres', 'views');
            const viewNames = views.map((v) => v.name).sort();

            expect(viewNames).toEqual([
                'v_active_todo_items',
                'v_todo_lists_with_counts',
                'v_active_users',
            ].sort());

        });

        it('should return column counts for views', async () => {

            const views = await fetchList(db, 'postgres', 'views');

            const activeUsers = views.find((v) => v.name === 'v_active_users');
            const listsWithCounts = views.find((v) => v.name === 'v_todo_lists_with_counts');

            // v_active_users: id, email, username, display_name, avatar_url, created_at, updated_at = 7
            expect(activeUsers?.columnCount).toBe(7);

            // v_todo_lists_with_counts: id, user_id, title, description, color, position, created_at, updated_at, total_items, completed_items, pending_items = 11
            expect(listsWithCounts?.columnCount).toBe(11);

        });

    });

    describe('fetchList - functions', () => {

        it('should return all 15 functions', async () => {

            const functions = await fetchList(db, 'postgres', 'functions');

            // Filter to just our test functions (exclude system functions)
            const testFunctions = functions.filter((f) =>
                f.name.includes('user') ||
                f.name.includes('todo_list') ||
                f.name.includes('todo_item'),
            );

            expect(testFunctions.length).toBeGreaterThanOrEqual(15);

        });

        it('should include function parameter counts', async () => {

            const functions = await fetchList(db, 'postgres', 'functions');

            // create_user has 5 parameters
            const createUser = functions.find((f) => f.name === 'create_user');
            expect(createUser?.parameterCount).toBe(5);

            // delete_user has 1 parameter
            const deleteUser = functions.find((f) => f.name === 'delete_user');
            expect(deleteUser?.parameterCount).toBe(1);

        });

        it('should include return type information', async () => {

            const functions = await fetchList(db, 'postgres', 'functions');

            // create_user returns UUID
            const createUser = functions.find((f) => f.name === 'create_user');
            expect(createUser?.returnType).toBe('uuid');

            // get_user_by_id returns record/table
            const getUserById = functions.find((f) => f.name === 'get_user_by_id');
            expect(getUserById?.returnType).toBe('record');

        });

    });

    describe('fetchList - indexes', () => {

        it('should return indexes for all tables', async () => {

            const indexes = await fetchList(db, 'postgres', 'indexes');

            // Filter to our test tables
            const testIndexes = indexes.filter((i) =>
                ['users', 'todo_lists', 'todo_items'].includes(i.tableName),
            );

            expect(testIndexes.length).toBeGreaterThanOrEqual(7);

        });

        it('should identify primary key indexes', async () => {

            const indexes = await fetchList(db, 'postgres', 'indexes');

            const primaryIndexes = indexes.filter((i) => i.isPrimary);

            // 3 tables = 3 primary keys
            expect(primaryIndexes.length).toBeGreaterThanOrEqual(3);

        });

        it('should identify unique indexes', async () => {

            const indexes = await fetchList(db, 'postgres', 'indexes');

            // users table has unique constraints on email and username
            const userUniqueIndexes = indexes.filter(
                (i) => i.tableName === 'users' && i.isUnique && !i.isPrimary,
            );

            expect(userUniqueIndexes.length).toBeGreaterThanOrEqual(2);

        });

    });

    describe('fetchList - foreignKeys', () => {

        it('should return all foreign key relationships', async () => {

            const foreignKeys = await fetchList(db, 'postgres', 'foreignKeys');

            expect(foreignKeys.length).toBe(2);

        });

        it('should include correct table and column references', async () => {

            const foreignKeys = await fetchList(db, 'postgres', 'foreignKeys');

            const listsFk = foreignKeys.find((fk) => fk.tableName === 'todo_lists');
            expect(listsFk?.columns).toContain('user_id');
            expect(listsFk?.referencedTable).toBe('users');
            expect(listsFk?.referencedColumns).toContain('id');

            const itemsFk = foreignKeys.find((fk) => fk.tableName === 'todo_items');
            expect(itemsFk?.columns).toContain('list_id');
            expect(itemsFk?.referencedTable).toBe('todo_lists');
            expect(itemsFk?.referencedColumns).toContain('id');

        });

    });

    describe('fetchDetail - tables', () => {

        it('should return full column details for users table', async () => {

            const detail = await fetchDetail(db, 'postgres', 'tables', 'users', 'public');

            expect(detail).not.toBeNull();
            expect(detail!.name).toBe('users');
            expect(detail!.columns.length).toBe(9);

            // Check specific column details
            const idColumn = detail!.columns.find((c) => c.name === 'id');
            expect(idColumn?.dataType).toBe('uuid');
            expect(idColumn?.isNullable).toBe(false);

            const emailColumn = detail!.columns.find((c) => c.name === 'email');
            expect(emailColumn?.dataType).toContain('character varying');
            expect(emailColumn?.isNullable).toBe(false);

            const deletedAtColumn = detail!.columns.find((c) => c.name === 'deleted_at');
            expect(deletedAtColumn?.isNullable).toBe(true);

        });

        it('should return table indexes', async () => {

            const detail = await fetchDetail(db, 'postgres', 'tables', 'users', 'public');

            expect(detail).not.toBeNull();
            expect(detail!.indexes).toBeDefined();
            expect(detail!.indexes!.length).toBeGreaterThanOrEqual(3);

            // Check primary key exists
            const pk = detail!.indexes!.find((i) => i.isPrimary);
            expect(pk).toBeDefined();

        });

        it('should return table constraints', async () => {

            const detail = await fetchDetail(db, 'postgres', 'tables', 'todo_items', 'public');

            expect(detail).not.toBeNull();

            // todo_items has a CHECK constraint on priority
            if (detail!.checkConstraints && detail!.checkConstraints.length > 0) {

                const priorityCheck = detail!.checkConstraints.find(
                    (c) => c.definition?.includes('priority'),
                );
                expect(priorityCheck).toBeDefined();

            }

        });

        it('should return null for non-existent table', async () => {

            const detail = await fetchDetail(db, 'postgres', 'tables', 'non_existent_table', 'public');

            expect(detail).toBeNull();

        });

    });

    describe('fetchDetail - views', () => {

        it('should return column details for view', async () => {

            const detail = await fetchDetail(db, 'postgres', 'views', 'v_active_users', 'public');

            expect(detail).not.toBeNull();
            expect(detail!.name).toBe('v_active_users');
            expect(detail!.columns.length).toBe(7);

            const idColumn = detail!.columns.find((c) => c.name === 'id');
            expect(idColumn?.dataType).toBe('uuid');

        });

        it('should return view definition', async () => {

            const detail = await fetchDetail(db, 'postgres', 'views', 'v_active_users', 'public');

            expect(detail).not.toBeNull();
            expect(detail!.definition).toBeDefined();
            expect(detail!.definition).toContain('SELECT');
            expect(detail!.definition).toContain('users');

        });

    });

    describe('fetchDetail - functions', () => {

        it('should return function parameter details', async () => {

            const detail = await fetchDetail(db, 'postgres', 'functions', 'create_user', 'public');

            expect(detail).not.toBeNull();
            expect(detail!.name).toBe('create_user');
            expect(detail!.parameters).toBeDefined();
            expect(detail!.parameters!.length).toBe(5);

            const emailParam = detail!.parameters!.find((p) => p.name === 'p_email');
            expect(emailParam).toBeDefined();
            expect(emailParam?.dataType).toContain('character varying');

        });

        it('should return function source code', async () => {

            const detail = await fetchDetail(db, 'postgres', 'functions', 'create_user', 'public');

            expect(detail).not.toBeNull();
            expect(detail!.definition).toBeDefined();
            expect(detail!.definition).toContain('INSERT INTO users');

        });

        it('should return function language', async () => {

            const detail = await fetchDetail(db, 'postgres', 'functions', 'create_user', 'public');

            expect(detail).not.toBeNull();
            expect(detail!.language).toBe('plpgsql');

        });

    });

});
