/**
 * Context.withSchema() tests.
 *
 * Covers schema-name validation, kysely getter re-derivation (compiled-SQL
 * qualification, replace-not-stack, no caching), proc/func/tvf name
 * prefixing, noorm pass-through, and shared #heldConnections across a
 * derived context and its parent.
 *
 * kysely-getter assertions connect for real against SQLite `:memory:`
 * (no external service, in-process, matches tests/core/connection/factory.test.ts's
 * precedent) rather than mocking `createConnection` — mock.module never
 * restores in this repo (see root CLAUDE.md), and this file is loaded
 * within the same `bun test --serial` process as the rest of tests/sdk.
 * proc/func/tvf and impersonate assertions use DummyDriver + a mocked
 * executor instead, mirroring tests/sdk/context.test.ts and
 * tests/sdk/impersonate/impersonate.test.ts.
 */
import { describe, it, expect, vi, afterEach } from 'bun:test';
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
// Fixtures
// ─────────────────────────────────────────────────────────────

function createMockConfig(dialect: Config['connection']['dialect']): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: true,
        access: { user: 'admin', agent: 'admin' },
        connection: dialect === 'sqlite'
            ? { dialect, database: ':memory:' }
            : { dialect, database: 'testdb' },
    };

}

const mockSettings: Settings = {};

const mockIdentity: Identity = {
    name: 'tester',
    source: 'system',
};

interface Ledger { id: number; amount: number }
interface AcctDB { ledger: Ledger }

interface TestProcs {
    'rebuild_ledger': [{ id: number }, void];
    'other.rebuild_ledger': [{ id: number }, void];
}

interface TestFuncs {
    'calc_total': [{ order_id: number }, { total: number }];
}

interface TestTvfs {
    'search_ledger': [{ q: string }, Ledger];
}

function createCtx<Procs = object, Funcs = object, Tvfs = object>(
    dialect: Config['connection']['dialect'] = 'postgres',
) {

    return new Context<AcctDB, Procs, Funcs, Tvfs>(
        createMockConfig(dialect),
        mockSettings,
        mockIdentity,
        {},
        '/tmp/test-project',
    );

}

/**
 * DummyDriver-backed Kysely with a mocked executor — captures compiled SQL
 * without hitting a real database. Mirrors context.test.ts / impersonate.test.ts.
 */
function createMockKysely(rows: Record<string, unknown>[] = []) {

    const executedSql: string[] = [];

    const executeQueryMock = vi.fn().mockImplementation((compiledQuery) => {

        executedSql.push(compiledQuery.sql);

        return { rows };

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

// ─────────────────────────────────────────────────────────────
// Schema Name Validation
// ─────────────────────────────────────────────────────────────

describe('sdk: Context.withSchema validation', () => {

    it('throws synchronously for an empty schema name', () => {

        const ctx = createCtx();

        expect(() => ctx.withSchema('')).toThrow();

    });

    it('throws synchronously for schema names with unsafe characters', () => {

        const ctx = createCtx();

        expect(() => ctx.withSchema('acct; DROP TABLE users')).toThrow();
        expect(() => ctx.withSchema('acct.other')).toThrow();
        expect(() => ctx.withSchema('acct-name')).toThrow();
        expect(() => ctx.withSchema('"acct"')).toThrow();
        expect(() => ctx.withSchema('acct name')).toThrow();

    });

    it('accepts alphanumeric and underscore schema names', () => {

        const ctx = createCtx();

        expect(() => ctx.withSchema('acct_1')).not.toThrow();

    });

    it('leaves the context usable after a rejected schema name — no partial state mutation', () => {

        const ctx = createCtx();

        expect(() => ctx.withSchema('bad name')).toThrow();
        expect(ctx.connected).toBe(false);

        // A later valid call still succeeds, proving the earlier throw left
        // no partial derivation or mutated shared state behind.
        expect(() => ctx.withSchema('good_name')).not.toThrow();

    });

});

// ─────────────────────────────────────────────────────────────
// kysely getter — schema-qualified compiled SQL
// ─────────────────────────────────────────────────────────────

describe('sdk: Context.withSchema kysely getter', () => {

    const connections: Context<AcctDB, object, object, object>[] = [];

    afterEach(async () => {

        for (const ctx of connections.splice(0)) await ctx.disconnect();

    });

    async function connectedCtx() {

        const ctx = createCtx('sqlite');

        await ctx.connect();
        connections.push(ctx);

        return ctx;

    }

    it('compiles queries qualified with the derived schema', async () => {

        const ctx = await connectedCtx();
        const derived = ctx.withSchema<AcctDB>('acct');

        const compiled = derived.kysely.selectFrom('ledger').selectAll().compile();

        expect(compiled.sql).toBe('select * from "acct"."ledger"');

    });

    it('leaves the parent context unqualified', async () => {

        const ctx = await connectedCtx();

        ctx.withSchema('acct'); // derived, but never queried through

        const compiled = ctx.kysely.selectFrom('ledger').selectAll().compile();

        expect(compiled.sql).toBe('select * from "ledger"');

    });

    it('replaces rather than stacks on a chained withSchema call', async () => {

        const ctx = await connectedCtx();
        const a = ctx.withSchema('a');
        const b = a.withSchema('b');

        expect(b.kysely.selectFrom('ledger').selectAll().compile().sql).toBe('select * from "b"."ledger"');

        // 'a' is a distinct instance, untouched by deriving 'b' from it.
        expect(a.kysely.selectFrom('ledger').selectAll().compile().sql).toBe('select * from "a"."ledger"');

    });

    it('never caches the wrapped instance — each access re-derives fresh', async () => {

        const ctx = await connectedCtx();
        const derived = ctx.withSchema('acct');

        expect(derived.kysely).not.toBe(derived.kysely);

    });

});

// ─────────────────────────────────────────────────────────────
// proc / func / tvf prefixing
// ─────────────────────────────────────────────────────────────

describe('sdk: Context.withSchema proc/func/tvf prefixing', () => {

    it('prefixes an unqualified proc name with the derived schema', async () => {

        const ctx = createCtx<TestProcs>('postgres');
        const derived = ctx.withSchema('acct');
        const { db, executeQueryMock } = createMockKysely();

        Object.defineProperty(derived, 'kysely', { value: db, configurable: true });

        await derived.proc('rebuild_ledger', { id: 1 });

        const query = executeQueryMock.mock.calls[0]![0];
        expect(query.sql).toBe('CALL "acct"."rebuild_ledger"("id" => $1)');

    });

    it('passes an already-dotted proc name through unchanged', async () => {

        const ctx = createCtx<TestProcs>('postgres');
        const derived = ctx.withSchema('acct');
        const { db, executeQueryMock } = createMockKysely();

        Object.defineProperty(derived, 'kysely', { value: db, configurable: true });

        await derived.proc('other.rebuild_ledger', { id: 1 });

        const query = executeQueryMock.mock.calls[0]![0];
        expect(query.sql).toBe('CALL "other"."rebuild_ledger"("id" => $1)');

    });

    it('does not prefix the parent context\'s proc calls', async () => {

        const ctx = createCtx<TestProcs>('postgres');

        ctx.withSchema('acct'); // derived, but proc is called on the parent

        const { db, executeQueryMock } = createMockKysely();

        Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

        await ctx.proc('rebuild_ledger', { id: 1 });

        const query = executeQueryMock.mock.calls[0]![0];
        expect(query.sql).toBe('CALL "rebuild_ledger"("id" => $1)');

    });

    it('prefixes an unqualified func name with the derived schema', async () => {

        const ctx = createCtx<object, TestFuncs>('postgres');
        const derived = ctx.withSchema('acct');
        const { db, executeQueryMock } = createMockKysely([{ total: 1 }]);

        Object.defineProperty(derived, 'kysely', { value: db, configurable: true });

        await derived.func('calc_total', { order_id: 1 }, 'total');

        const query = executeQueryMock.mock.calls[0]![0];
        expect(query.sql).toBe('SELECT "acct"."calc_total"("order_id" => $1) AS "total"');

    });

    it('prefixes an unqualified tvf name with the derived schema', async () => {

        const ctx = createCtx<object, object, TestTvfs>('postgres');
        const derived = ctx.withSchema('acct');
        const { db, executeQueryMock } = createMockKysely();

        Object.defineProperty(derived, 'kysely', { value: db, configurable: true });

        await derived.tvf('search_ledger', { q: 'x' });

        const query = executeQueryMock.mock.calls[0]![0];
        expect(query.sql).toBe('SELECT * FROM "acct"."search_ledger"("q" => $1)');

    });

});

// ─────────────────────────────────────────────────────────────
// noorm pass-through
// ─────────────────────────────────────────────────────────────

describe('sdk: Context.withSchema noorm pass-through', () => {

    it('exposes the same config/settings/identity as the parent — shared #state', () => {

        const ctx = createCtx();
        const derived = ctx.withSchema('acct');

        expect(derived.noorm.config).toBe(ctx.noorm.config);
        expect(derived.noorm.settings).toBe(ctx.noorm.settings);
        expect(derived.noorm.identity).toBe(ctx.noorm.identity);

    });

    it('has no schema-specific noorm behavior — dialect stays the parent\'s', () => {

        const ctx = createCtx('mssql');
        const derived = ctx.withSchema('acct');

        expect(derived.dialect).toBe(ctx.dialect);

    });

});

// ─────────────────────────────────────────────────────────────
// Shared #heldConnections
// ─────────────────────────────────────────────────────────────

describe('sdk: Context.withSchema shared #heldConnections', () => {

    it('releases a derived context\'s explicit impersonation scope when the parent disconnects', async () => {

        const ctx = createCtx('sqlite');

        // Real, in-process connection — needed so disconnect() proceeds past
        // its #state.connection guard. dialect/kysely are overridden below
        // on the derived context so impersonate() borrows a fake
        // postgres-shaped connection instead of the real sqlite one.
        await ctx.connect();

        const derived = ctx.withSchema('acct');

        const executedSql: string[] = [];
        let markReleased!: () => void;
        const released = new Promise<void>((resolve) => {

            markReleased = resolve;

        });

        const executeQueryMock = vi.fn().mockImplementation((compiledQuery) => {

            executedSql.push(compiledQuery.sql);

            return { rows: [] };

        });

        const mockDb = new Kysely<unknown>({
            dialect: {
                createAdapter: () => new PostgresAdapter(),
                createDriver: () => new DummyDriver(),
                createIntrospector: (db) => new PostgresIntrospector(db),
                createQueryCompiler: () => new PostgresQueryCompiler(),
            },
        });

        vi.spyOn(mockDb.getExecutor(), 'provideConnection').mockImplementation(async (consumer) => {

            // Resolves only once Context's impersonate-explicit callback
            // finishes awaiting its held-connection promise — i.e. only
            // after something calls release(). Proves #heldConnections
            // actually drained, not just that disconnect() ran.
            const result = await consumer({
                executeQuery: executeQueryMock,
                streamQuery: () => {

                    throw new Error('not implemented');

                },
            });

            markReleased();

            return result;

        });

        Object.defineProperty(derived, 'kysely', { value: mockDb, configurable: true });
        Object.defineProperty(derived, 'dialect', { value: 'postgres', configurable: true });

        await derived.impersonate('bob');

        expect(executedSql[0]).toBe("SET ROLE 'bob'");

        await ctx.disconnect();

        const outcome = await Promise.race([
            released.then(() => 'released' as const),
            new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 500)),
        ]);

        expect(outcome).toBe('released');

    });

});
