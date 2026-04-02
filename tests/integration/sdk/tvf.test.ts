/**
 * Integration tests for ctx.tvf() against real databases.
 *
 * Tests table-valued function calls on PostgreSQL and MSSQL using
 * the SDK Context class with live database connections.
 * Requires docker-compose containers to be running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';

import type { Kysely } from 'kysely';

import { Context } from '../../../src/sdk/context.js';
import { buildTvfCall } from '../../../src/sdk/sql.js';
import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
    resetTestData,
    teardownTestSchema,
    skipIfNoContainer,
    TEST_CONNECTIONS,
    makeTestConfig,
} from '../../utils/db.js';

import type { Settings } from '../../../src/core/settings/types.js';
import type { Identity } from '../../../src/core/identity/types.js';
import type { ConnectionResult } from '../../../src/core/connection/types.js';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const mockSettings: Settings = {};
const mockIdentity: Identity = { name: 'tester', source: 'system' };

interface TodoItem {
    id: string;
    list_id: string;
    title: string;
    description: string | null;
    is_completed: boolean | number;
    priority: number;
    position: number;
}

interface TodoList {
    id: string;
    user_id: string;
    title: string;
    description: string | null;
    color: string | null;
    position: number;
}

interface ActiveUser {
    id: string;
    email: string;
    username: string;
    display_name: string | null;
}

interface TestTvfs {
    'fn_get_todo_items_by_list': { p_list_id: string };
    'fn_get_todo_lists_by_user': { p_user_id: string };
    'fn_get_active_users': void;
}

interface MssqlTestTvfs {
    'fn_GetTodoItemsByList': [string];
    'fn_GetTodoListsByUser': [string];
    'fn_GetActiveUsers': void;
}

// Known seed data IDs from tests/utils/db.ts seedTestData
const USER_ID_1 = '11111111-1111-1111-1111-111111111111';
const LIST_ID_1 = '44444444-4444-4444-4444-444444444444';
const _LIST_ID_2 = '55555555-5555-5555-5555-555555555555';

// ─────────────────────────────────────────────────────────────
// PostgreSQL
// ─────────────────────────────────────────────────────────────

describe('integration: postgres tvf()', () => {

    let conn: ConnectionResult;
    let db: Kysely<unknown>;
    let ctx: Context<unknown, object, object, TestTvfs>;

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        conn = await createTestConnection('postgres');
        db = conn.db;

        await teardownTestSchema(db, 'postgres');
        await deployTestSchema(db, 'postgres');

        const config = makeTestConfig('test-pg', TEST_CONNECTIONS['postgres']);

        ctx = new Context<unknown, object, object, TestTvfs>(
            config,
            mockSettings,
            mockIdentity,
            {},
            '/tmp/test-project',
        );

        // Wire the real connection into the context
        Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

    });

    afterAll(async () => {

        if (conn) await conn.destroy();

    });

    beforeEach(async () => {

        await resetTestData(db, 'postgres');
        await seedTestData(db, 'postgres');

    });

    it('should return todo items for a list using named params', async () => {

        const items = await ctx.tvf<TodoItem>('fn_get_todo_items_by_list', { p_list_id: LIST_ID_1 });

        expect(items.length).toBe(2);
        expect(items[0]!.list_id).toBe(LIST_ID_1);
        expect(items[1]!.list_id).toBe(LIST_ID_1);

    });

    it('should return todo lists for a user using named params', async () => {

        const lists = await ctx.tvf<TodoList>('fn_get_todo_lists_by_user', { p_user_id: USER_ID_1 });

        expect(lists.length).toBe(2);
        expect(lists[0]!.user_id).toBe(USER_ID_1);

    });

    it('should return active users with no params', async () => {

        const users = await ctx.tvf<ActiveUser>('fn_get_active_users');

        expect(users.length).toBe(3);
        expect(users[0]!.email).toBeDefined();
        expect(users[0]!.username).toBeDefined();

    });

    it('should return empty array for non-matching params', async () => {

        const items = await ctx.tvf<TodoItem>(
            'fn_get_todo_items_by_list',
            { p_list_id: '00000000-0000-0000-0000-000000000000' },
        );

        expect(items).toEqual([]);

    });

    it('should generate correct SQL via buildTvfCall', () => {

        const query = buildTvfCall('postgres', 'fn_get_todo_items_by_list', { p_list_id: LIST_ID_1 });
        const compiled = query.compile(db);

        expect(compiled.sql).toBe('SELECT * FROM fn_get_todo_items_by_list(p_list_id => $1)');
        expect(compiled.parameters).toEqual([LIST_ID_1]);

    });

});

// ─────────────────────────────────────────────────────────────
// MSSQL
// ─────────────────────────────────────────────────────────────

describe('integration: mssql tvf()', () => {

    let conn: ConnectionResult;
    let db: Kysely<unknown>;
    let ctx: Context<unknown, object, object, MssqlTestTvfs>;

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        conn = await createTestConnection('mssql');
        db = conn.db;

        await teardownTestSchema(db, 'mssql');
        await deployTestSchema(db, 'mssql');

        const config = makeTestConfig('test-mssql', TEST_CONNECTIONS['mssql']);

        ctx = new Context<unknown, object, object, MssqlTestTvfs>(
            config,
            mockSettings,
            mockIdentity,
            {},
            '/tmp/test-project',
        );

        Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

    });

    afterAll(async () => {

        if (conn) await conn.destroy();

    });

    beforeEach(async () => {

        await resetTestData(db, 'mssql');
        await seedTestData(db, 'mssql');

    });

    it('should return todo items for a list using positional params', async () => {

        const items = await ctx.tvf<TodoItem>('fn_GetTodoItemsByList', [LIST_ID_1]);

        expect(items.length).toBe(2);

        for (const item of items) {

            expect(item.list_id).toBe(LIST_ID_1.toUpperCase());

        }

    });

    it('should return todo lists for a user using positional params', async () => {

        const lists = await ctx.tvf<TodoList>('fn_GetTodoListsByUser', [USER_ID_1]);

        expect(lists.length).toBe(2);

    });

    it('should return active users with no params', async () => {

        const users = await ctx.tvf<ActiveUser>('fn_GetActiveUsers');

        expect(users.length).toBe(3);
        expect(users[0]!.email).toBeDefined();
        expect(users[0]!.username).toBeDefined();

    });

    it('should return empty array for non-matching params', async () => {

        const items = await ctx.tvf<TodoItem>(
            'fn_GetTodoItemsByList',
            ['00000000-0000-0000-0000-000000000000'],
        );

        expect(items).toEqual([]);

    });

    it('should generate correct SQL via buildTvfCall', () => {

        const query = buildTvfCall('mssql', 'fn_GetTodoItemsByList', [LIST_ID_1]);
        const compiled = query.compile(db);

        expect(compiled.sql).toBe('SELECT * FROM fn_GetTodoItemsByList(@1)');
        expect(compiled.parameters).toEqual([LIST_ID_1]);

    });

});
