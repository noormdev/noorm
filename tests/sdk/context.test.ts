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
        protected: false,
        connection: { dialect, database: 'testdb' },
    };

}

const mockSettings: Settings = {};

const mockIdentity: Identity = {
    name: 'tester',
    source: 'system',
};

interface TestProcs {
    'get_users': { department_id: number; active: boolean };
    'simple_proc': [number, string];
    'refresh_cache': void;
}

interface TestFuncs {
    'calc_total': { order_id: number };
    'add_numbers': [number, number];
    'get_version': void;
}

type TestDB = unknown;

function createContext<
    Procs = object,
    Funcs = object,
>(dialect: Config['connection']['dialect'] = 'postgres') {

    return new Context<TestDB, Procs, Funcs>(
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

        it('should accept named params matching the interface', () => {

            const ctx = createContext<TestProcs>('postgres');

            // Valid — named params match TestProcs['get_users']
            // This line just needs to compile, not execute
            const _call: () => Promise<unknown[]> = () => ctx.proc('get_users', { department_id: 1, active: true });
            expect(_call).toBeDefined();

        });

        it('should accept positional params matching the interface', () => {

            const ctx = createContext<TestProcs>('postgres');

            const _call: () => Promise<unknown[]> = () => ctx.proc('simple_proc', [42, 'hello']);
            expect(_call).toBeDefined();

        });

        it('should accept void procs with no args', () => {

            const ctx = createContext<TestProcs>('postgres');

            const _call: () => Promise<unknown[]> = () => ctx.proc('refresh_cache');
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

    });

    describe('func() type constraints', () => {

        it('should accept named params with column', () => {

            const ctx = createContext<object, TestFuncs>('postgres');

            const _call = () => ctx.func('calc_total', { order_id: 42 }, 'total');
            expect(_call).toBeDefined();

        });

        it('should accept positional params with column', () => {

            const ctx = createContext<object, TestFuncs>('postgres');

            const _call = () => ctx.func('add_numbers', [1, 2], 'result');
            expect(_call).toBeDefined();

        });

        it('should accept void funcs with just column', () => {

            const ctx = createContext<object, TestFuncs>('postgres');

            const _call = () => ctx.func('get_version', 'v');
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

            const result = await ctx.proc<{ id: number; name: string }>('get_users', { department_id: 1, active: true });

            expect(result).toEqual(mockRows);

        });

        it('should return empty array when no rows', async () => {

            const ctx = createContext<TestProcs>('postgres');
            const { db } = createMockKysely([]);

            Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

            const result = await ctx.proc('refresh_cache');

            expect(result).toEqual([]);

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

            const result = await ctx.func<{ total: number }>('calc_total', { order_id: 42 }, 'total');

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

});
