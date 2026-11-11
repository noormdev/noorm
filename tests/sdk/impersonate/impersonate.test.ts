/**
 * Context.impersonate() lifecycle tests.
 *
 * Verifies callback and explicit modes, dialect checking,
 * error propagation, and guaranteed revert behavior.
 */
import { describe, it, expect } from 'bun:test';
import { attempt } from '@logosdx/utils';
import {
    Kysely,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
    sql,
} from 'kysely';
import type { DatabaseConnection, Driver } from 'kysely';

import { trackPinnedConnections } from '../../../src/core/connection/pinned.js';
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
 * A pool of one connection behind the real pin tracker, so a test can tell a
 * connection that went back to the pool from one that was closed.
 */
function createFakePool() {

    const executedSql: string[] = [];
    const failing = new Set<string>();
    const stats = { opened: 0, closed: 0 };
    const pins = trackPinnedConnections();
    const waiting: Array<() => void> = [];
    let idle: DatabaseConnection | null = null;
    let busy = false;

    const open = (): DatabaseConnection => {

        stats.opened++;

        return {
            executeQuery: async (query) => {

                executedSql.push(query.sql);

                if (failing.has(query.sql)) throw new Error(`${query.sql} failed`);

                return { rows: [] };

            },
            streamQuery: () => {

                throw new Error('not implemented');

            },
        };

    };

    const driver: Driver = {
        init: async () => {},
        acquireConnection: async () => {

            const pinTo = pins.claim();

            if (busy) await new Promise<void>((resolve) => waiting.push(resolve));

            busy = true;

            const connection = idle ?? open();

            idle = null;
            pinTo(connection);

            return connection;

        },
        releaseConnection: async (connection) => {

            if (pins.isDiscarded(connection)) stats.closed++;
            else idle = connection;

            busy = false;
            waiting.shift()?.();

        },
        beginTransaction: async () => {},
        commitTransaction: async () => {},
        rollbackTransaction: async () => {},
        destroy: async () => {},
    };

    const db = new Kysely<unknown>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => driver,
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    return { db, executedSql, stats, failOn: (statement: string) => failing.add(statement), withConnection: pins.withConnection(db) };

}

function createCtx(dialect: Config['connection']['dialect'] = 'postgres') {

    const ctx = new Context(
        createMockConfig(dialect),
        mockSettings,
        mockIdentity,
        {},
        '/tmp/test-project',
    );

    const { db, withConnection, ...pool } = createFakePool();

    Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });
    Object.defineProperty(ctx, 'withConnection', { value: withConnection, configurable: true });

    return { ctx, ...pool };

}

/** False when the pool's one connection is still checked out. */
function canCheckOut(ctx: Context): Promise<boolean> {

    return Promise.race([
        sql`select 1`.execute(ctx.kysely).then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);

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


    it('should return the connection to the pool after a clean revert', async () => {

        // Discarding costs a reconnect, so only a failed identity switch may pay it.
        const { ctx, stats } = createCtx('postgres');

        await ctx.impersonate('testuser', async () => {});

        expect(await canCheckOut(ctx)).toBe(true);
        expect(stats).toEqual({ opened: 1, closed: 0 });

    });

    it('should close the connection when the revert statement fails', async () => {

        // A pooled connection still under SET ROLE would run the next borrower's queries as testuser.
        const { ctx, stats, failOn } = createCtx('postgres');

        failOn('RESET ROLE');

        const [, err] = await attempt(() => ctx.impersonate('testuser', async () => {}));

        expect(err?.message).toBe('RESET ROLE failed');
        expect(stats.closed).toBe(1);
        expect(await canCheckOut(ctx)).toBe(true);
        expect(stats.opened).toBe(2);

    });

    it('should close the connection when the impersonate statement fails', async () => {

        // A statement that timed out client-side may still have been applied by the server.
        const { ctx, stats, failOn } = createCtx('postgres');
        let callbackRan = false;

        failOn("SET ROLE 'testuser'");

        const [, err] = await attempt(() => ctx.impersonate('testuser', async () => {

            callbackRan = true;

        }));

        expect(err?.message).toBe("SET ROLE 'testuser' failed");
        expect(callbackRan).toBe(false);
        expect(stats.closed).toBe(1);

    });

    it('should reject with the revert failure when the callback also threw', async () => {

        // The revert failure is the one that closed a connection, so it is the one the caller hears about.
        const { ctx, stats, failOn } = createCtx('postgres');

        failOn('RESET ROLE');

        const [, err] = await attempt(() => ctx.impersonate('testuser', async () => {

            throw new Error('boom');

        }));

        expect(err?.message).toBe('RESET ROLE failed');
        expect(stats.closed).toBe(1);

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

    it('should return the connection to the pool after a clean revert', async () => {

        const { ctx, stats } = createCtx('postgres');

        const scope = await ctx.impersonate('testuser');

        await scope.revert();

        expect(await canCheckOut(ctx)).toBe(true);
        expect(stats).toEqual({ opened: 1, closed: 0 });

    });

    it('should free the pool slot and close the connection when revert() fails', async () => {

        // A failed revert used to keep the connection checked out until disconnect().
        const { ctx, stats, failOn } = createCtx('postgres');

        const scope = await ctx.impersonate('testuser');

        failOn('RESET ROLE');

        const [, err] = await attempt(() => scope.revert());

        expect(err?.message).toBe('RESET ROLE failed');
        expect(await canCheckOut(ctx)).toBe(true);
        expect(stats).toEqual({ opened: 2, closed: 1 });

    });

    it('should not run the revert statement again after a failed revert()', async () => {

        // The connection is closed by then, and its slot may already belong to another caller.
        const { ctx, executedSql, failOn } = createCtx('postgres');

        const scope = await ctx.impersonate('testuser');

        failOn('RESET ROLE');
        await attempt(() => scope.revert());

        const [, err] = await attempt(() => scope.revert());

        expect(err).toBeNull();
        expect(executedSql.filter(s => s === 'RESET ROLE')).toHaveLength(1);

    });

    it('should close the connection when the impersonate statement fails', async () => {

        const { ctx, stats, failOn } = createCtx('postgres');

        failOn("SET ROLE 'testuser'");

        const [scope, err] = await attempt(() => ctx.impersonate('testuser'));

        expect(err?.message).toBe("SET ROLE 'testuser' failed");
        expect(scope).toBeNull();
        expect(await canCheckOut(ctx)).toBe(true);
        expect(stats).toEqual({ opened: 2, closed: 1 });

    });

});
