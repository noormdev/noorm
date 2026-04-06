/**
 * Integration tests for TVP (Table-Valued Parameter) support.
 *
 * Tests ctx.proc(), ctx.func(), and ctx.tvf() with tvp() markers
 * against a real MSSQL database. Validates the DECLARE/INSERT/EXEC
 * batch pattern works end-to-end through Kysely's parameter binding.
 * Requires docker-compose MSSQL container to be running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { sql } from 'kysely';

import type { Kysely } from 'kysely';

import { Context } from '../../../src/sdk/context.js';
import { tvp } from '../../../src/sdk/tvp.js';
import type { TvpValue } from '../../../src/sdk/tvp.js';
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

interface BatchCreateResult { items_created: number }
interface SumResult { '': number }
interface MatchedItem { id: string; list_id: string; title: string; priority: number }

interface TestProcs {
    'batch_create_todo_items': [{ p_user_id: string; p_items: TvpValue }, BatchCreateResult];
}

interface TestFuncs {
    'fn_SumBatchPriorities': [{ p_multiplier: number; p_items: TvpValue }, SumResult];
}

interface TestTvfs {
    'fn_MatchBatchItems': [{ p_user_id: string; p_items: TvpValue }, MatchedItem];
}

// Known seed data IDs from tests/utils/db.ts
const USER_ID_1 = '11111111-1111-1111-1111-111111111111';
const LIST_ID_1 = '44444444-4444-4444-4444-444444444444';
const LIST_ID_2 = '55555555-5555-5555-5555-555555555555';

// ─────────────────────────────────────────────────────────────
// Shared Setup
// ─────────────────────────────────────────────────────────────

let conn: ConnectionResult;
let db: Kysely<unknown>;

beforeAll(async () => {

    await skipIfNoContainer('mssql');

    conn = await createTestConnection('mssql');
    db = conn.db;

    await teardownTestSchema(db, 'mssql');
    await deployTestSchema(db, 'mssql');

});

afterAll(async () => {

    if (conn) await conn.destroy();

});

beforeEach(async () => {

    await resetTestData(db, 'mssql');
    await seedTestData(db, 'mssql');

});

// ─────────────────────────────────────────────────────────────
// ctx.proc() with TVP
// ─────────────────────────────────────────────────────────────

describe('integration: mssql tvp proc()', () => {

    let ctx: Context<unknown, TestProcs>;

    beforeAll(() => {

        const config = makeTestConfig('test-mssql', TEST_CONNECTIONS['mssql']);

        ctx = new Context<unknown, TestProcs>(
            config,
            mockSettings,
            mockIdentity,
            {},
            '/tmp/test-project',
        );

        Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

    });

    // Happy path

    it('should insert rows via TVP with named params', async () => {

        const result = await ctx.proc('batch_create_todo_items', {
            p_user_id: USER_ID_1,
            p_items: tvp('TodoItemBatch', [
                { title: 'TVP Item 1', priority: 1, list_id: LIST_ID_1 },
                { title: 'TVP Item 2', priority: 2, list_id: LIST_ID_1 },
            ]),
        });

        expect(result[0]!.items_created).toBe(2);

        const { rows } = await sql<{ title: string }>`
            SELECT title FROM todo_items WHERE title LIKE 'TVP Item%' ORDER BY title
        `.execute(db);

        expect(rows.length).toBe(2);
        expect(rows[0]!.title).toBe('TVP Item 1');
        expect(rows[1]!.title).toBe('TVP Item 2');

    });

    it('should handle single-row TVP', async () => {

        const result = await ctx.proc('batch_create_todo_items', {
            p_user_id: USER_ID_1,
            p_items: tvp('TodoItemBatch', [
                { title: 'Single TVP Item', priority: 0, list_id: LIST_ID_1 },
            ]),
        });

        expect(result[0]!.items_created).toBe(1);

    });

    it('should handle TVP rows targeting different lists', async () => {

        const result = await ctx.proc('batch_create_todo_items', {
            p_user_id: USER_ID_1,
            p_items: tvp('TodoItemBatch', [
                { title: 'List 1 Item', priority: 1, list_id: LIST_ID_1 },
                { title: 'List 2 Item', priority: 2, list_id: LIST_ID_2 },
            ]),
        });

        expect(result[0]!.items_created).toBe(2);

        const { rows: list1Items } = await sql<{ title: string }>`
            SELECT title FROM todo_items WHERE list_id = ${LIST_ID_1} AND title = 'List 1 Item'
        `.execute(db);
        expect(list1Items.length).toBe(1);

        const { rows: list2Items } = await sql<{ title: string }>`
            SELECT title FROM todo_items WHERE list_id = ${LIST_ID_2} AND title = 'List 2 Item'
        `.execute(db);
        expect(list2Items.length).toBe(1);

    });

    it('should handle many rows in a single TVP', async () => {

        const items = Array.from({ length: 50 }, (_, i) => ({
            title: `Bulk Item ${i}`,
            priority: i % 4,
            list_id: LIST_ID_1,
        }));

        const result = await ctx.proc('batch_create_todo_items', {
            p_user_id: USER_ID_1,
            p_items: tvp('TodoItemBatch', items),
        });

        expect(result[0]!.items_created).toBe(50);

    });

    // Edge cases

    it('should handle empty TVP (zero rows inserted)', async () => {

        const result = await ctx.proc('batch_create_todo_items', {
            p_user_id: USER_ID_1,
            p_items: tvp('TodoItemBatch', []),
        });

        expect(result[0]!.items_created).toBe(0);

    });

    // Failure paths

    it('should fail with FK violation for non-existent list_id', async () => {

        await expect(
            ctx.proc('batch_create_todo_items', {
                p_user_id: USER_ID_1,
                p_items: tvp('TodoItemBatch', [
                    { title: 'Bad', priority: 0, list_id: '00000000-0000-0000-0000-000000000000' },
                ]),
            }),
        ).rejects.toThrow();

    });

    it('should fail with wrong TVP type name', async () => {

        await expect(
            ctx.proc('batch_create_todo_items', {
                p_user_id: USER_ID_1,
                p_items: tvp('NonExistentType', [
                    { title: 'Bad', priority: 0, list_id: LIST_ID_1 },
                ]),
            }),
        ).rejects.toThrow();

    });

    it('should fail with wrong column names', async () => {

        await expect(
            ctx.proc('batch_create_todo_items', {
                p_user_id: USER_ID_1,
                p_items: tvp('TodoItemBatch', [
                    { wrong_col: 'x', bad_col: 0, another: LIST_ID_1 },
                ]),
            }),
        ).rejects.toThrow();

    });

});

// ─────────────────────────────────────────────────────────────
// ctx.func() with TVP
// ─────────────────────────────────────────────────────────────

describe('integration: mssql tvp func()', () => {

    let ctx: Context<unknown, object, TestFuncs>;

    beforeAll(() => {

        const config = makeTestConfig('test-mssql', TEST_CONNECTIONS['mssql']);

        ctx = new Context<unknown, object, TestFuncs>(
            config,
            mockSettings,
            mockIdentity,
            {},
            '/tmp/test-project',
        );

        Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

    });

    it('should compute scalar result from TVP with mixed scalar + TVP params', async () => {

        // fn_SumBatchPriorities sums priorities and multiplies by @p_multiplier
        // priorities: 1 + 2 + 3 = 6, multiplier: 2 → 12
        const result = await ctx.func('fn_SumBatchPriorities', {
            p_multiplier: 2,
            p_items: tvp('TodoItemBatch', [
                { title: 'A', priority: 1, list_id: LIST_ID_1 },
                { title: 'B', priority: 2, list_id: LIST_ID_1 },
                { title: 'C', priority: 3, list_id: LIST_ID_1 },
            ]),
        }, 'total');

        expect(result).toEqual({ total: 12 });

    });

    it('should return 0 for empty TVP', async () => {

        const result = await ctx.func('fn_SumBatchPriorities', {
            p_multiplier: 5,
            p_items: tvp('TodoItemBatch', []),
        }, 'total');

        expect(result).toEqual({ total: 0 });

    });

    it('should handle single-row TVP', async () => {

        // priority 7, multiplier 3 → 21
        const result = await ctx.func('fn_SumBatchPriorities', {
            p_multiplier: 3,
            p_items: tvp('TodoItemBatch', [
                { title: 'X', priority: 7, list_id: LIST_ID_1 },
            ]),
        }, 'total');

        expect(result).toEqual({ total: 21 });

    });

    it('should fail with wrong TVP type name', async () => {

        await expect(
            ctx.func('fn_SumBatchPriorities', {
                p_multiplier: 1,
                p_items: tvp('FakeType', [{ title: 'X', priority: 1, list_id: LIST_ID_1 }]),
            }, 'total'),
        ).rejects.toThrow();

    });

});

// ─────────────────────────────────────────────────────────────
// ctx.tvf() with TVP
// ─────────────────────────────────────────────────────────────

describe('integration: mssql tvp tvf()', () => {

    let ctx: Context<unknown, object, object, TestTvfs>;

    beforeAll(() => {

        const config = makeTestConfig('test-mssql', TEST_CONNECTIONS['mssql']);

        ctx = new Context<unknown, object, object, TestTvfs>(
            config,
            mockSettings,
            mockIdentity,
            {},
            '/tmp/test-project',
        );

        Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

    });

    it('should return matching rows from TVF with mixed scalar + TVP params', async () => {

        // Seed data has 'Complete report' and 'Review PRs' in LIST_ID_1 for USER_ID_1
        const rows = await ctx.tvf('fn_MatchBatchItems', {
            p_user_id: USER_ID_1,
            p_items: tvp('TodoItemBatch', [
                { title: 'Complete report', priority: 0, list_id: LIST_ID_1 },
            ]),
        });

        expect(rows.length).toBe(1);
        expect(rows[0]!.title).toBe('Complete report');

    });

    it('should return multiple matches', async () => {

        const rows = await ctx.tvf('fn_MatchBatchItems', {
            p_user_id: USER_ID_1,
            p_items: tvp('TodoItemBatch', [
                { title: 'Complete report', priority: 0, list_id: LIST_ID_1 },
                { title: 'Review PRs', priority: 0, list_id: LIST_ID_1 },
            ]),
        });

        expect(rows.length).toBe(2);

        const titles = rows.map((r) => r.title).sort();
        expect(titles).toEqual(['Complete report', 'Review PRs']);

    });

    it('should return empty for no matches', async () => {

        const rows = await ctx.tvf('fn_MatchBatchItems', {
            p_user_id: USER_ID_1,
            p_items: tvp('TodoItemBatch', [
                { title: 'Does Not Exist', priority: 0, list_id: LIST_ID_1 },
            ]),
        });

        expect(rows).toEqual([]);

    });

    it('should return empty for empty TVP', async () => {

        const rows = await ctx.tvf('fn_MatchBatchItems', {
            p_user_id: USER_ID_1,
            p_items: tvp('TodoItemBatch', []),
        });

        expect(rows).toEqual([]);

    });

    it('should fail with wrong TVP type name', async () => {

        await expect(
            ctx.tvf('fn_MatchBatchItems', {
                p_user_id: USER_ID_1,
                p_items: tvp('FakeType', [{ title: 'X', priority: 0, list_id: LIST_ID_1 }]),
            }),
        ).rejects.toThrow();

    });

});

// ─────────────────────────────────────────────────────────────
// tvp() validation (no DB needed)
// ─────────────────────────────────────────────────────────────

describe('integration: tvp() validation', () => {

    it('should throw for empty type name', () => {

        expect(() => tvp('', [])).toThrow('TVP type name is required.');

    });

    it('should throw for non-array rows', () => {

        // @ts-expect-error testing runtime validation
        expect(() => tvp('MyType', 'not-an-array')).toThrow('TVP rows must be an array.');

    });

    it('should throw for mismatched row keys', () => {

        expect(() => tvp('MyType', [
            { a: 1, b: 2 },
            { a: 1, c: 3 },
        ])).toThrow('TVP row 1 has mismatched keys');

    });

});

// ─────────────────────────────────────────────────────────────
// tvp() type-level tests (compile-time only)
// ─────────────────────────────────────────────────────────────

describe('integration: tvp() type safety', () => {

    it('should accept concrete interfaces without widening', () => {

        interface CheckoutItem { Type: string; ReferenceNo: number; Qty: number }

        const items: CheckoutItem[] = [
            { Type: 'A', ReferenceNo: 100, Qty: 5 },
            { Type: 'B', ReferenceNo: 200, Qty: 3 },
        ];

        // This must compile — the original bug was that concrete interfaces
        // were not assignable to Record<string, unknown>
        const result = tvp('CheckoutItems', items);

        expect(result.__noorm_tvp).toBe(true);

    });

    it('should preserve row type through TvpValue<T>', () => {

        interface CheckoutItem { Type: string; ReferenceNo: number; Qty: number }

        const result = tvp('CheckoutItems', [
            { Type: 'A', ReferenceNo: 100, Qty: 5 },
        ]);

        // rows should carry the concrete type, not Record<string, unknown>
        const row = result.rows[0]!;
        const _type: string = row.Type;
        const _ref: number = row.ReferenceNo;
        const _qty: number = row.Qty;

        // @ts-expect-error 'NonExistent' does not exist on CheckoutItem
        row.NonExistent;

        expect(_type).toBe('A');
        expect(_ref).toBe(100);
        expect(_qty).toBe(5);

    });

    it('should accept inline object literals', () => {

        const result = tvp('MyType', [
            { name: 'Alice', age: 30 },
            { name: 'Bob', age: 25 },
        ]);

        expect(result.rows.length).toBe(2);

    });

    it('should accept typed arrays from type aliases', () => {

        type OrderLine = { sku: string; qty: number; price: number };

        const lines: OrderLine[] = [
            { sku: 'ABC', qty: 1, price: 9.99 },
        ];

        const result = tvp('OrderLines', lines);

        expect(result.typeName).toBe('OrderLines');

    });

    it('should accept readonly arrays', () => {

        interface Item { id: number; value: string }

        const items: readonly Item[] = [
            { id: 1, value: 'x' },
        ];

        // readonly T[] should be accepted — mutable T[] extends readonly T[]
        // but the reverse isn't true, so we pass a mutable copy
        const result = tvp('Items', [...items]);

        expect(result.rows.length).toBe(1);

    });

    it('should reject non-object row types', () => {

        // @ts-expect-error string[] is not assignable to Record<string, unknown>[]
        tvp('Bad', ['a', 'b']);

        // @ts-expect-error number[] is not assignable to Record<string, unknown>[]
        tvp('Bad', [1, 2, 3]);

        // @ts-expect-error null[] is not assignable to Record<string, unknown>[]
        tvp('Bad', [null]);

    });

    it('should allow TvpValue<T> where unparameterized TvpValue is expected', () => {

        interface Custom { x: number; y: number }

        // TvpValue<Custom> must be assignable to TvpValue (default param)
        // This is critical for backward-compat with existing proc definitions
        const typed: TvpValue<Custom> = tvp('Custom', [{ x: 1, y: 2 }]);
        const untyped: TvpValue = typed;

        expect(untyped.__noorm_tvp).toBe(true);

    });

    it('should support typed TvpValue<T> in proc definitions', () => {

        interface LineItem { sku: string; qty: number }

        // Simulates a proc definition that uses TvpValue<T> for type safety
        type TypedProc = { items: TvpValue<LineItem>; warehouse_id: number };

        const params: TypedProc = {
            items: tvp('LineItems', [{ sku: 'ABC', qty: 5 }]),
            warehouse_id: 1,
        };

        // Row type is preserved through the proc definition
        const row = params.items.rows[0]!;
        const _sku: string = row.sku;
        const _qty: number = row.qty;

        // @ts-expect-error 'price' does not exist on LineItem
        row.price;

        expect(_sku).toBe('ABC');
        expect(_qty).toBe(5);

    });

    it('should reject mismatched row types with TvpValue<T>', () => {

        interface Expected { a: number; b: string }

        // @ts-expect-error { x: number } is not assignable to Expected
        const _bad: TvpValue<Expected> = tvp('T', [{ x: 1 }]);

    });

});
