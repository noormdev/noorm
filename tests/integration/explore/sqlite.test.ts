/**
 * SQLite Explore Integration Tests
 *
 * Tests the explore module against a real SQLite in-memory database.
 * Verifies fetchOverview, fetchList, and fetchDetail operations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';

import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
} from '../../utils/db.js';
import {
    fetchOverview,
    fetchList,
    fetchDetail,
} from '../../../src/core/explore/index.js';


describe('integration: sqlite explore', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        const conn = await createTestConnection('sqlite');
        db = conn.db;
        destroy = conn.destroy;

        await deployTestSchema(db, 'sqlite');
        await seedTestData(db, 'sqlite');

    });

    afterAll(async () => {

        await destroy();

    });

    describe('fetchOverview', () => {

        it('should return correct counts for all object types', async () => {

            const overview = await fetchOverview(db, 'sqlite');

            expect(overview.tables).toBe(3);
            expect(overview.views).toBe(3);
            expect(overview.procedures).toBe(0);
            expect(overview.functions).toBe(0);
            expect(overview.types).toBe(0);

        });

        it('should return correct index count', async () => {

            const overview = await fetchOverview(db, 'sqlite');

            // SQLite fixture has 6 explicit indexes (partial indexes)
            // idx_users_email, idx_users_username
            // idx_todo_lists_user_id, idx_todo_lists_position
            // idx_todo_items_list_id, idx_todo_items_position, idx_todo_items_due_date
            expect(overview.indexes).toBeGreaterThanOrEqual(6);

        });

        it('should return correct foreign key count', async () => {

            const overview = await fetchOverview(db, 'sqlite');

            // 2 FK relationships: todo_lists -> users, todo_items -> todo_lists
            expect(overview.foreignKeys).toBe(2);

        });

    });

    describe('fetchList: tables', () => {

        it('should return all 3 tables with correct names', async () => {

            const tables = await fetchList(db, 'sqlite', 'tables');

            expect(tables).toHaveLength(3);

            const tableNames = tables.map((t) => t.name).sort();
            expect(tableNames).toEqual(['todo_items', 'todo_lists', 'users']);

        });

        it('should return column counts for each table', async () => {

            const tables = await fetchList(db, 'sqlite', 'tables');

            const usersTable = tables.find((t) => t.name === 'users');
            expect(usersTable).toBeDefined();
            expect(usersTable!.columnCount).toBe(8); // id, email, username, password_hash, display_name, avatar_url, created_at, updated_at, deleted_at

            const todoListsTable = tables.find((t) => t.name === 'todo_lists');
            expect(todoListsTable).toBeDefined();
            expect(todoListsTable!.columnCount).toBe(9); // id, user_id, title, description, color, position, created_at, updated_at, deleted_at

        });

        it('should return row count estimates', async () => {

            const tables = await fetchList(db, 'sqlite', 'tables');

            const usersTable = tables.find((t) => t.name === 'users');
            expect(usersTable).toBeDefined();
            expect(usersTable!.rowCountEstimate).toBe(3); // Seeded 3 users

            const todoItemsTable = tables.find((t) => t.name === 'todo_items');
            expect(todoItemsTable).toBeDefined();
            expect(todoItemsTable!.rowCountEstimate).toBe(3); // Seeded 3 items

        });

    });

    describe('fetchList: views', () => {

        it('should return all 3 views', async () => {

            const views = await fetchList(db, 'sqlite', 'views');

            expect(views).toHaveLength(3);

            const viewNames = views.map((v) => v.name).sort();
            expect(viewNames).toEqual([
                'v_active_todo_items',
                'v_active_users',
                'v_todo_lists_with_counts',
            ]);

        });

        it('should return column counts for views', async () => {

            const views = await fetchList(db, 'sqlite', 'views');

            const activeUsersView = views.find((v) => v.name === 'v_active_users');
            expect(activeUsersView).toBeDefined();
            expect(activeUsersView!.columnCount).toBeGreaterThan(0);

            // v_active_users selects: id, email, username, display_name, avatar_url, created_at, updated_at
            expect(activeUsersView!.columnCount).toBe(7);

        });

        it('should mark views as not updatable', async () => {

            const views = await fetchList(db, 'sqlite', 'views');

            for (const view of views) {

                expect(view.isUpdatable).toBe(false);

            }

        });

    });

    describe('fetchList: procedures and functions', () => {

        it('should return empty array for procedures (SQLite unsupported)', async () => {

            const procedures = await fetchList(db, 'sqlite', 'procedures');

            expect(procedures).toEqual([]);

        });

        it('should return empty array for functions (SQLite unsupported)', async () => {

            const functions = await fetchList(db, 'sqlite', 'functions');

            expect(functions).toEqual([]);

        });

    });

    describe('fetchList: types', () => {

        it('should return empty array for types (SQLite unsupported)', async () => {

            const types = await fetchList(db, 'sqlite', 'types');

            expect(types).toEqual([]);

        });

    });

    describe('fetchList: indexes', () => {

        it('should return indexes for all tables', async () => {

            const indexes = await fetchList(db, 'sqlite', 'indexes');

            expect(indexes.length).toBeGreaterThanOrEqual(6);

            // Check some specific indexes exist
            const indexNames = indexes.map((i) => i.name);
            expect(indexNames).toContain('idx_users_email');
            expect(indexNames).toContain('idx_users_username');
            expect(indexNames).toContain('idx_todo_lists_user_id');
            expect(indexNames).toContain('idx_todo_items_list_id');

        });

        it('should include table names for indexes', async () => {

            const indexes = await fetchList(db, 'sqlite', 'indexes');

            const usersEmailIdx = indexes.find((i) => i.name === 'idx_users_email');
            expect(usersEmailIdx).toBeDefined();
            expect(usersEmailIdx!.tableName).toBe('users');

        });

        it('should include column information', async () => {

            const indexes = await fetchList(db, 'sqlite', 'indexes');

            const usersEmailIdx = indexes.find((i) => i.name === 'idx_users_email');
            expect(usersEmailIdx).toBeDefined();
            expect(usersEmailIdx!.columns).toContain('email');

        });

    });

    describe('fetchList: foreignKeys', () => {

        it('should return all foreign key relationships', async () => {

            const foreignKeys = await fetchList(db, 'sqlite', 'foreignKeys');

            expect(foreignKeys).toHaveLength(2);

        });

        it('should include correct FK details', async () => {

            const foreignKeys = await fetchList(db, 'sqlite', 'foreignKeys');

            // todo_lists -> users FK
            const todoListsFK = foreignKeys.find((fk) => fk.tableName === 'todo_lists');
            expect(todoListsFK).toBeDefined();
            expect(todoListsFK!.referencedTable).toBe('users');
            expect(todoListsFK!.columns).toContain('user_id');
            expect(todoListsFK!.referencedColumns).toContain('id');

            // todo_items -> todo_lists FK
            const todoItemsFK = foreignKeys.find((fk) => fk.tableName === 'todo_items');
            expect(todoItemsFK).toBeDefined();
            expect(todoItemsFK!.referencedTable).toBe('todo_lists');
            expect(todoItemsFK!.columns).toContain('list_id');

        });

        it('should include ON DELETE CASCADE action', async () => {

            const foreignKeys = await fetchList(db, 'sqlite', 'foreignKeys');

            const todoListsFK = foreignKeys.find((fk) => fk.tableName === 'todo_lists');
            expect(todoListsFK).toBeDefined();
            expect(todoListsFK!.onDelete).toBe('CASCADE');

        });

    });

    describe('fetchDetail: tables', () => {

        it('should return full detail for users table', async () => {

            const detail = await fetchDetail(db, 'sqlite', 'tables', 'users');

            expect(detail).not.toBeNull();
            expect(detail!.name).toBe('users');
            expect(detail!.columns).toBeDefined();
            expect(detail!.indexes).toBeDefined();
            expect(detail!.foreignKeys).toBeDefined();

        });

        it('should return correct column details', async () => {

            const detail = await fetchDetail(db, 'sqlite', 'tables', 'users');

            expect(detail).not.toBeNull();

            const idColumn = detail!.columns.find((c) => c.name === 'id');
            expect(idColumn).toBeDefined();
            expect(idColumn!.isPrimaryKey).toBe(true);
            expect(idColumn!.dataType).toBe('TEXT');

            const emailColumn = detail!.columns.find((c) => c.name === 'email');
            expect(emailColumn).toBeDefined();
            expect(emailColumn!.isNullable).toBe(false);
            expect(emailColumn!.dataType).toBe('TEXT');

            const deletedAtColumn = detail!.columns.find((c) => c.name === 'deleted_at');
            expect(deletedAtColumn).toBeDefined();
            expect(deletedAtColumn!.isNullable).toBe(true);

        });

        it('should return row count estimate', async () => {

            const detail = await fetchDetail(db, 'sqlite', 'tables', 'users');

            expect(detail).not.toBeNull();
            expect(detail!.rowCountEstimate).toBe(3);

        });

        it('should return indexes for the table', async () => {

            const detail = await fetchDetail(db, 'sqlite', 'tables', 'users');

            expect(detail).not.toBeNull();
            expect(detail!.indexes.length).toBeGreaterThanOrEqual(2);

            const emailIdx = detail!.indexes.find((i) => i.name === 'idx_users_email');
            expect(emailIdx).toBeDefined();

        });

        it('should return null for non-existent table', async () => {

            const detail = await fetchDetail(db, 'sqlite', 'tables', 'nonexistent_table');

            expect(detail).toBeNull();

        });

    });

    describe('fetchDetail: views', () => {

        it('should return full detail for v_active_users view', async () => {

            const detail = await fetchDetail(db, 'sqlite', 'views', 'v_active_users');

            expect(detail).not.toBeNull();
            expect(detail!.name).toBe('v_active_users');
            expect(detail!.columns).toBeDefined();
            expect(detail!.columns.length).toBe(7);
            expect(detail!.isUpdatable).toBe(false);

        });

        it('should include view definition', async () => {

            const detail = await fetchDetail(db, 'sqlite', 'views', 'v_active_users');

            expect(detail).not.toBeNull();
            expect(detail!.definition).toBeDefined();
            expect(detail!.definition).toContain('CREATE VIEW');
            expect(detail!.definition).toContain('v_active_users');

        });

        it('should return null for non-existent view', async () => {

            const detail = await fetchDetail(db, 'sqlite', 'views', 'nonexistent_view');

            expect(detail).toBeNull();

        });

    });

    describe('fetchDetail: unsupported categories', () => {

        it('should return null for procedures (SQLite unsupported)', async () => {

            const detail = await fetchDetail(db, 'sqlite', 'procedures', 'any_proc');

            expect(detail).toBeNull();

        });

        it('should return null for functions (SQLite unsupported)', async () => {

            const detail = await fetchDetail(db, 'sqlite', 'functions', 'any_func');

            expect(detail).toBeNull();

        });

        it('should return null for types (SQLite unsupported)', async () => {

            const detail = await fetchDetail(db, 'sqlite', 'types', 'any_type');

            expect(detail).toBeNull();

        });

    });

    describe('noorm table filtering', () => {

        it('should exclude __noorm_ prefixed tables by default', async () => {

            // The fetchOverview and fetchList exclude noorm tables by default
            const tables = await fetchList(db, 'sqlite', 'tables');

            const noormTables = tables.filter((t) => t.name.startsWith('__noorm_'));
            expect(noormTables).toHaveLength(0);

        });

    });

});
