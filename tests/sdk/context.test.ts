/**
 * Context proc/func tests.
 *
 * Covers type-level constraints (compile-time) and runtime behavior
 * for the proc() and func() methods on the Context class.
 */
import { describe, it, expect, vi } from 'bun:test';
import {
    Kysely,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';

import { Context } from '../../src/sdk/context.js';
import { tvp } from '../../src/sdk/tvp.js';
import type { TvpValue } from '../../src/sdk/tvp.js';

import type { Config } from '../../src/core/config/types.js';
import type { Settings } from '../../src/core/settings/types.js';
import type { Identity } from '../../src/core/identity/types.js';

// ─────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────

function createMockConfig(dialect: Config['connection']['dialect'] = 'postgres'): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: true,
        access: { user: 'admin', mcp: 'admin' },
        connection: { dialect, database: 'testdb' },
    };

}

const mockSettings: Settings = {};

const mockIdentity: Identity = {
    name: 'tester',
    source: 'system',
};

interface User { id: number; name: string }
interface CalcResult { total: number }
interface Session { session_key: string; expires_at: string }

interface TestProcs {
    'get_users': [{ department_id: number; active: boolean }, User];
    'simple_proc': [[number, string], void];
    'refresh_cache': void;
    'checkout_trx': [{ Party: number; PaymentMethod: number; Items: TvpValue }, void];
    'checkout_positional': [[number, number, TvpValue], void];
}

interface TestFuncs {
    'calc_total': [{ order_id: number }, CalcResult];
    'add_numbers': [[number, number], CalcResult];
    'get_version': void;
}

interface TestTvfs {
    'validate_session': [{ session_key: string }, Session];
    'search_products': [[string, number], Session];
    'get_active_items': void;
}

type TestDB = unknown;

function createContext<
    Procs = object,
    Funcs = object,
    Tvfs = object,
>(dialect: Config['connection']['dialect'] = 'postgres') {

    return new Context<TestDB, Procs, Funcs, Tvfs>(
        createMockConfig(dialect),
        mockSettings,
        mockIdentity,
        {},
        '/tmp/test-project',
    );

}

// ─────────────────────────────────────────────────────────────
// Type-Level Tests
// ─────────────────────────────────────────────────────────────

describe('sdk: Context types', () => {

    describe('proc() type constraints', () => {

        it('should accept named params matching the tuple args', () => {

            const ctx = createContext<TestProcs>('postgres');

            // Valid — named params match ExtractArgs<TestProcs['get_users']>
            const _call: () => Promise<User[]> = () => ctx.proc('get_users', { department_id: 1, active: true });
            expect(_call).toBeDefined();

        });

        it('should accept positional params matching the tuple args', () => {

            const ctx = createContext<TestProcs>('postgres');

            const _call: () => Promise<void[]> = () => ctx.proc('simple_proc', [42, 'hello']);
            expect(_call).toBeDefined();

        });

        it('should accept void procs with no args', () => {

            const ctx = createContext<TestProcs>('postgres');

            const _call: () => Promise<unknown[]> = () => ctx.proc('refresh_cache');
            expect(_call).toBeDefined();

        });

        it('should infer return type from tuple', () => {

            const ctx = createContext<TestProcs>('postgres');

            // Return type is User[] inferred from [Args, User]
            const _call: () => Promise<User[]> = () => ctx.proc('get_users', { department_id: 1, active: true });
            expect(_call).toBeDefined();

        });

        it('should allow explicit return type override', () => {

            const ctx = createContext<TestProcs>('postgres');

            // Override inferred User with a different type
            interface SpecialUser { id: number; name: string; extra: boolean }
            const _call: () => Promise<SpecialUser[]> = () => ctx.proc<'get_users', SpecialUser>('get_users', { department_id: 1, active: true });
            expect(_call).toBeDefined();

        });

        it('should reject invalid procedure names', () => {

            const ctx = createContext<TestProcs>('postgres');

            // @ts-expect-error 'nonexistent' is not a key of TestProcs
            const _call = () => ctx.proc('nonexistent');
            expect(_call).toBeDefined();

        });

        it('should reject wrong param types', () => {

            const ctx = createContext<TestProcs>('postgres');

            // @ts-expect-error string is not assignable to { department_id: number; active: boolean }
            const _call = () => ctx.proc('get_users', 'wrong');
            expect(_call).toBeDefined();

        });

        it('should reject params on void procs', () => {

            const ctx = createContext<TestProcs>('postgres');

            // @ts-expect-error refresh_cache is void — no params allowed
            const _call = () => ctx.proc('refresh_cache', { extra: true });
            expect(_call).toBeDefined();

        });

        it('should prevent calling proc() when Procs is empty', () => {

            const ctx = createContext('postgres');

            // @ts-expect-error keyof {} = never — no valid procedure names exist
            const _call = () => ctx.proc('anything');
            expect(_call).toBeDefined();

        });

        it('should accept TVP in named params', () => {

            const ctx = createContext<TestProcs>('mssql');

            const _call: () => Promise<void[]> = () => ctx.proc('checkout_trx', {
                Party: 1,
                PaymentMethod: 2,
                Items: tvp('CheckoutItems', [
                    { Type: 1, ReferenceNo: 100, Qty: 5 },
                ]),
            });
            expect(_call).toBeDefined();

        });

        it('should accept TVP in positional params', () => {

            const ctx = createContext<TestProcs>('mssql');

            const _call: () => Promise<void[]> = () => ctx.proc('checkout_positional', [
                1,
                2,
                tvp('CheckoutItems', [{ Type: 1, ReferenceNo: 100, Qty: 5 }]),
            ]);
            expect(_call).toBeDefined();

        });

    });

    describe('func() type constraints', () => {

        it('should accept named params with column', () => {

            const ctx = createContext<object, TestFuncs>('postgres');

            const _call: () => Promise<CalcResult> = () => ctx.func('calc_total', { order_id: 42 }, 'total');
            expect(_call).toBeDefined();

        });

        it('should accept positional params with column', () => {

            const ctx = createContext<object, TestFuncs>('postgres');

            const _call: () => Promise<CalcResult> = () => ctx.func('add_numbers', [1, 2], 'result');
            expect(_call).toBeDefined();

        });

        it('should accept void funcs with just column', () => {

            const ctx = createContext<object, TestFuncs>('postgres');

            const _call = () => ctx.func('get_version', 'v');
            expect(_call).toBeDefined();

        });

        it('should infer return type from tuple', () => {

            const ctx = createContext<object, TestFuncs>('postgres');

            // Return type is CalcResult inferred from [Args, CalcResult]
            const _call: () => Promise<CalcResult> = () => ctx.func('calc_total', { order_id: 42 }, 'total');
            expect(_call).toBeDefined();

        });

        it('should allow explicit return type override', () => {

            const ctx = createContext<object, TestFuncs>('postgres');

            interface DetailedResult { total: number; tax: number }
            const _call: () => Promise<DetailedResult> = () => ctx.func<'calc_total', DetailedResult>('calc_total', { order_id: 42 }, 'total');
            expect(_call).toBeDefined();

        });

        it('should reject invalid function names', () => {

            const ctx = createContext<object, TestFuncs>('postgres');

            // @ts-expect-error 'nonexistent' is not a key of TestFuncs
            const _call = () => ctx.func('nonexistent', 'col');
            expect(_call).toBeDefined();

        });

        it('should reject wrong param types', () => {

            const ctx = createContext<object, TestFuncs>('postgres');

            // @ts-expect-error string is not assignable to { order_id: number }
            const _call = () => ctx.func('calc_total', 'wrong', 'total');

            expect(_call).toBeDefined();

        });

        it('should prevent calling func() when Funcs is empty', () => {

            const ctx = createContext('postgres');

            // @ts-expect-error keyof {} = never — no valid function names exist
            const _call = () => ctx.func('anything', 'col');
            expect(_call).toBeDefined();

        });

    });

    describe('tvf() type constraints', () => {

        it('should accept named params matching the tuple args', () => {

            const ctx = createContext<object, object, TestTvfs>('postgres');

            const _call: () => Promise<Session[]> = () => ctx.tvf('validate_session', { session_key: 'abc' });
            expect(_call).toBeDefined();

        });

        it('should accept positional params matching the tuple args', () => {

            const ctx = createContext<object, object, TestTvfs>('postgres');

            const _call: () => Promise<Session[]> = () => ctx.tvf('search_products', ['widget', 100]);
            expect(_call).toBeDefined();

        });

        it('should accept void tvfs with no args', () => {

            const ctx = createContext<object, object, TestTvfs>('postgres');

            const _call: () => Promise<unknown[]> = () => ctx.tvf('get_active_items');
            expect(_call).toBeDefined();

        });

        it('should infer return type from tuple', () => {

            const ctx = createContext<object, object, TestTvfs>('postgres');

            // Return type is Session[] inferred from [Args, Session]
            const _call: () => Promise<Session[]> = () => ctx.tvf('validate_session', { session_key: 'abc' });
            expect(_call).toBeDefined();

        });

        it('should allow explicit return type override', () => {

            const ctx = createContext<object, object, TestTvfs>('postgres');

            interface ExtendedSession { session_key: string; expires_at: string; user_id: number }
            const _call: () => Promise<ExtendedSession[]> = () => ctx.tvf<'validate_session', ExtendedSession>('validate_session', { session_key: 'abc' });
            expect(_call).toBeDefined();

        });

        it('should reject invalid tvf names', () => {

            const ctx = createContext<object, object, TestTvfs>('postgres');

            // @ts-expect-error 'nonexistent' is not a key of TestTvfs
            const _call = () => ctx.tvf('nonexistent');
            expect(_call).toBeDefined();

        });

        it('should reject wrong param types', () => {

            const ctx = createContext<object, object, TestTvfs>('postgres');

            // @ts-expect-error number is not assignable to { session_key: string }
            const _call = () => ctx.tvf('validate_session', 999);
            expect(_call).toBeDefined();

        });

        it('should reject params on void tvfs', () => {

            const ctx = createContext<object, object, TestTvfs>('postgres');

            // @ts-expect-error get_active_items is void — no params allowed
            const _call = () => ctx.tvf('get_active_items', { extra: true });
            expect(_call).toBeDefined();

        });

        it('should prevent calling tvf() when Tvfs is empty', () => {

            const ctx = createContext('postgres');

            // @ts-expect-error keyof {} = never — no valid tvf names exist
            const _call = () => ctx.tvf('anything');
            expect(_call).toBeDefined();

        });

    });

});

// ─────────────────────────────────────────────────────────────
// Runtime Tests
// ─────────────────────────────────────────────────────────────

/**
 * Create a real Kysely instance with DummyDriver that returns
 * controlled rows from executeQuery.
 */
function createMockKysely(rows: Record<string, unknown>[] = []) {

    const executeQueryMock = vi.fn().mockResolvedValue({ rows });

    const db = new Kysely<unknown>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    // Intercept the executor's executeQuery to return our mock rows
    const originalExecutor = db.getExecutor();

    vi.spyOn(originalExecutor, 'provideConnection').mockImplementation(async (consumer) => {

        return consumer({
            executeQuery: executeQueryMock,
            streamQuery: () => {

                throw new Error('not implemented');

            },
        });

    });

    return { db, executeQueryMock };

}

describe('sdk: Context proc/func runtime', () => {

    describe('proc()', () => {

        it('should throw sqlite error before accessing kysely', async () => {

            const ctx = createContext<TestProcs>('sqlite');

            // The sqlite check fires before this.kysely is accessed,
            // so even without a connection it throws the sqlite error
            await expect(ctx.proc('refresh_cache')).rejects.toThrow(
                'SQLite does not support stored procedures.',
            );

        });

        it('should execute and return rows', async () => {

            const ctx = createContext<TestProcs>('postgres');
            const mockRows = [{ id: 1, name: 'Alice' }];
            const { db } = createMockKysely(mockRows);

            Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

            const result = await ctx.proc('get_users', { department_id: 1, active: true });

            expect(result).toEqual(mockRows);

        });

        it('should return empty array when no rows', async () => {

            const ctx = createContext<TestProcs>('postgres');
            const { db } = createMockKysely([]);

            Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

            const result = await ctx.proc('refresh_cache');

            expect(result).toEqual([]);

        });

        it('should execute TVP proc with named params', async () => {

            const ctx = createContext<TestProcs>('mssql');
            const { db, executeQueryMock } = createMockKysely([]);

            Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });
            Object.defineProperty(ctx, 'dialect', { value: 'mssql', configurable: true });

            await ctx.proc('checkout_trx', {
                Party: 1,
                PaymentMethod: 2,
                Items: tvp('CheckoutItems', [
                    { Type: 1, ReferenceNo: 100, Qty: 5 },
                ]),
            });

            expect(executeQueryMock).toHaveBeenCalledTimes(1);

            const query = executeQueryMock.mock.calls[0][0];

            expect(query.sql).toContain('DECLARE @__tvp_Items CheckoutItems');
            expect(query.sql).toContain('INSERT INTO @__tvp_Items');
            expect(query.sql).toContain('EXEC [checkout_trx]');

        });

    });

    describe('func()', () => {

        it('should throw sqlite error before accessing kysely', async () => {

            const ctx = createContext<object, TestFuncs>('sqlite');

            await expect(ctx.func('get_version', 'v')).rejects.toThrow(
                'SQLite does not support database function calls.',
            );

        });

        it('should execute and return first row', async () => {

            const ctx = createContext<object, TestFuncs>('postgres');
            const { db } = createMockKysely([{ total: 99 }]);

            Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

            const result = await ctx.func('calc_total', { order_id: 42 }, 'total');

            expect(result).toEqual({ total: 99 });

        });

        it('should return null when no rows', async () => {

            const ctx = createContext<object, TestFuncs>('postgres');
            const { db } = createMockKysely([]);

            Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

            const result = await ctx.func('get_version', 'v');

            expect(result).toBeNull();

        });

    });

    describe('tvf()', () => {

        it('should throw sqlite error before accessing kysely', async () => {

            const ctx = createContext<object, object, TestTvfs>('sqlite');

            await expect(ctx.tvf('get_active_items')).rejects.toThrow(
                'SQLite does not support table-valued functions.',
            );

        });

        it('should throw mysql error before accessing kysely', async () => {

            const ctx = createContext<object, object, TestTvfs>('mysql');

            await expect(ctx.tvf('get_active_items')).rejects.toThrow(
                'MySQL does not support table-valued functions.',
            );

        });

        it('should execute and return all rows', async () => {

            const ctx = createContext<object, object, TestTvfs>('postgres');
            const mockRows = [
                { session_key: 'abc', expires_at: '2026-12-31' },
                { session_key: 'def', expires_at: '2026-06-15' },
            ];
            const { db } = createMockKysely(mockRows);

            Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

            const result = await ctx.tvf('validate_session', { session_key: 'abc' });

            expect(result).toEqual(mockRows);

        });

        it('should return empty array when no rows', async () => {

            const ctx = createContext<object, object, TestTvfs>('postgres');
            const { db } = createMockKysely([]);

            Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

            const result = await ctx.tvf('get_active_items');

            expect(result).toEqual([]);

        });

    });

});
