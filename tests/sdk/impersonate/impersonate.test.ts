/**
 * Context.impersonate() lifecycle tests.
 *
 * Verifies callback and explicit modes, dialect checking,
 * error propagation, and guaranteed revert behavior.
 */
import { describe, it, expect, vi } from 'bun:test';
import {
    Kysely,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';

import { Context } from '../../../src/sdk/context.js';
import { ImpersonationError } from '../../../src/sdk/impersonate/types.js';

import type { Config } from '../../../src/core/config/types.js';
import type { Settings } from '../../../src/core/settings/types.js';
import type { Identity } from '../../../src/core/identity/types.js';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function createMockConfig(dialect: Config['connection']['dialect'] = 'postgres'): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: true,
        access: { user: 'admin', agent: 'admin' },
        connection: { dialect, database: 'testdb' },
    };

}

const mockSettings: Settings = {};

const mockIdentity: Identity = {
    name: 'tester',
    source: 'system',
};

/**
 * Create a mock Kysely with connection() support.
 *
 * The key: we intercept provideConnection so .connection().execute()
 * calls our mock, and we track all raw SQL executed against it.
 */
function createMockKysely() {

    const executedSql: string[] = [];

    const executeQueryMock = vi.fn().mockImplementation((compiledQuery) => {

        executedSql.push(compiledQuery.sql);

        return { rows: [] };

    });

    const db = new Kysely<unknown>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    const originalExecutor = db.getExecutor();

    vi.spyOn(originalExecutor, 'provideConnection').mockImplementation(async (consumer) => {

        return consumer({
            executeQuery: executeQueryMock,
            streamQuery: () => {

                throw new Error('not implemented');

            },
        });

    });

    return { db, executedSql, executeQueryMock };

}

function createCtx(dialect: Config['connection']['dialect'] = 'postgres') {

    const ctx = new Context(
        createMockConfig(dialect),
        mockSettings,
        mockIdentity,
        {},
        '/tmp/test-project',
    );

    const { db, executedSql, executeQueryMock } = createMockKysely();

    Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

    return { ctx, executedSql, executeQueryMock };

}

// ─────────────────────────────────────────────────────────────
// Unsupported Dialects
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate unsupported dialects', () => {

    it('should throw ImpersonationError for mysql', async () => {

        const { ctx } = createCtx('mysql');

        await expect(ctx.impersonate('user', async () => {})).rejects.toThrow(ImpersonationError);

    });

    it('should throw ImpersonationError for sqlite', async () => {

        const { ctx } = createCtx('sqlite');

        await expect(ctx.impersonate('user', async () => {})).rejects.toThrow(ImpersonationError);

    });

    it('should include dialect name in error message', async () => {

        const { ctx } = createCtx('mysql');

        await expect(ctx.impersonate('user', async () => {})).rejects.toThrow('mysql');

    });

});

// ─────────────────────────────────────────────────────────────
// Callback Mode
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate callback mode', () => {

    it('should execute impersonate SQL then revert SQL', async () => {

        const { ctx, executedSql } = createCtx('postgres');

        await ctx.impersonate('testuser', async () => {});

        expect(executedSql[0]).toBe("SET ROLE 'testuser'");
        expect(executedSql[1]).toBe('RESET ROLE');

    });

    it('should return the callback result', async () => {

        const { ctx } = createCtx('postgres');

        const result = await ctx.impersonate('testuser', async () => 42);

        expect(result).toBe(42);

    });

    it('should provide a scope with kysely', async () => {

        const { ctx } = createCtx('postgres');

        await ctx.impersonate('testuser', async (scope) => {

            expect(scope.kysely).toBeDefined();
            expect(scope.proc).toBeFunction();
            expect(scope.func).toBeFunction();
            expect(scope.transaction).toBeFunction();
            expect(scope.revert).toBeFunction();

        });

    });

    it('should revert even when callback throws', async () => {

        const { ctx, executedSql } = createCtx('postgres');

        await expect(
            ctx.impersonate('testuser', async () => {

                throw new Error('boom');

            }),
        ).rejects.toThrow('boom');

        expect(executedSql[0]).toBe("SET ROLE 'testuser'");
        expect(executedSql[1]).toBe('RESET ROLE');

    });

    it('should generate EXECUTE AS for mssql', async () => {

        const { ctx, executedSql } = createCtx('mssql');

        await ctx.impersonate('testuser', async () => {});

        expect(executedSql[0]).toBe("EXECUTE AS USER = 'testuser'");
        expect(executedSql[1]).toBe('REVERT');

    });

});

// ─────────────────────────────────────────────────────────────
// Explicit Mode
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate explicit mode', () => {

    it('should return a scope', async () => {

        const { ctx } = createCtx('postgres');

        const scope = await ctx.impersonate('testuser');

        expect(scope.kysely).toBeDefined();
        expect(scope.revert).toBeFunction();

        await scope.revert();

    });

    it('should execute impersonate SQL on acquire', async () => {

        const { ctx, executedSql } = createCtx('postgres');

        const scope = await ctx.impersonate('testuser');

        expect(executedSql[0]).toBe("SET ROLE 'testuser'");

        await scope.revert();

    });

    it('should execute revert SQL on scope.revert()', async () => {

        const { ctx, executedSql } = createCtx('postgres');

        const scope = await ctx.impersonate('testuser');

        await scope.revert();

        expect(executedSql[1]).toBe('RESET ROLE');

    });

    it('should make revert() idempotent', async () => {

        const { ctx, executedSql } = createCtx('postgres');

        const scope = await ctx.impersonate('testuser');

        await scope.revert();
        await scope.revert();
        await scope.revert();

        // Only one RESET ROLE, not three
        const revertCount = executedSql.filter(s => s === 'RESET ROLE').length;

        expect(revertCount).toBe(1);

    });

    it('should work with mssql dialect', async () => {

        const { ctx, executedSql } = createCtx('mssql');

        const scope = await ctx.impersonate('testuser');

        expect(executedSql[0]).toBe("EXECUTE AS USER = 'testuser'");

        await scope.revert();

        expect(executedSql[1]).toBe('REVERT');

    });

    it('should throw for unsupported dialect in explicit mode', async () => {

        const { ctx } = createCtx('mysql');

        await expect(ctx.impersonate('user')).rejects.toThrow(ImpersonationError);

    });

});
