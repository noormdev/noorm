import { describe, it, expect, vi } from 'bun:test';
import { attempt } from '@logosdx/utils';
import {
    Kysely,
    Transaction,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';
import type { CompiledQuery } from 'kysely';

import { Context } from '../../src/sdk/context.js';
import { buildScope } from '../../src/sdk/impersonate/scope.js';
import type { TransactionScope, RoutineCalls } from '../../src/sdk/index.js';

import type { Config } from '../../src/core/config/types.js';
import type { Settings } from '../../src/core/settings/types.js';
import type { Identity } from '../../src/core/identity/types.js';

interface Ledger { id: number; amount: number }
interface LedgerDB { ledger: Ledger }

interface TestProcs {
    'rebuild_ledger': [{ id: number }, Ledger];
    'refresh_cache': void;
}

interface TestFuncs {
    'calc_total': [{ order_id: number }, { total: number }];
}

interface TestTvfs {
    'search_ledger': [{ q: string }, Ledger];
}

const config: Config = {
    name: 'test',
    type: 'local',
    isTest: true,
    access: { user: 'admin', agent: 'admin' },
    connection: { dialect: 'postgres', database: 'testdb' },
};

const mockSettings: Settings = {};
const mockIdentity: Identity = { name: 'tester', source: 'system' };

/** PG's answer to `CALL` against a FUNCTION. */
const notAProcedure = Object.assign(new Error('rebuild_ledger(id => integer) is not a procedure'), { code: '42809' });

/**
 * DummyDriver-backed Kysely that records every compiled statement and its
 * parameters, answers with `rows` (or `rows(sql)`), and throws `failOn(sql)`'s
 * error when it returns one.
 */
function createMockKysely(
    rows: Record<string, unknown>[] | ((sql: string) => Record<string, unknown>[]) = [],
    failOn: (sql: string) => Error | null = () => null,
) {

    const executedSql: string[] = [];
    const executedParams: (readonly unknown[])[] = [];

    const db = new Kysely<LedgerDB>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (kysely) => new PostgresIntrospector(kysely),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    vi.spyOn(db.getExecutor(), 'provideConnection').mockImplementation(async (consumer) => {

        return consumer({
            executeQuery: vi.fn().mockImplementation(async (compiled: CompiledQuery) => {

                executedSql.push(compiled.sql);
                executedParams.push(compiled.parameters);

                const err = failOn(compiled.sql);

                if (err) throw err;

                return { rows: typeof rows === 'function' ? rows(compiled.sql) : rows };

            }),
            streamQuery: () => {

                throw new Error('not implemented');

            },
        });

    });

    return { db, executedSql, executedParams };

}

const isLookup = (sql: string) => sql.includes('pg_catalog.pg_proc');

function lookupAnswers(isProcedure: boolean, rows: Record<string, unknown>[] = []) {

    return (sql: string) => isLookup(sql) ? [{ is_procedure: isProcedure }] : rows;

}

function createCtx(db: Kysely<LedgerDB>) {

    const ctx = new Context<LedgerDB, TestProcs, TestFuncs, TestTvfs>(
        config,
        mockSettings,
        mockIdentity,
        {},
        '/tmp/test-project',
    );

    Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

    return ctx;

}

describe('sdk: transaction handle routines', () => {

    it('should pass a Kysely Transaction that also carries proc/func/tvf', async () => {

        const { db } = createMockKysely();
        const ctx = createCtx(db);

        const handle = await ctx.transaction(async (trx) => trx);

        expect(handle).toBeInstanceOf(Transaction);
        expect(typeof handle.proc).toBe('function');
        expect(typeof handle.func).toBe('function');
        expect(typeof handle.tvf).toBe('function');

    });

    it('should keep the query builder working on the handle', async () => {

        const ledger: Ledger = { id: 1, amount: 10 };
        const { db, executedSql } = createMockKysely([{ ...ledger }]);
        const ctx = createCtx(db);

        const rows = await ctx.transaction((trx) => trx.selectFrom('ledger').selectAll().execute());

        expect(rows).toEqual([ledger]);
        expect(executedSql).toEqual(['select * from "ledger"']);

    });

    it('should return all rows from trx.tvf', async () => {

        const ledger: Ledger = { id: 1, amount: 10 };
        const { db, executedSql } = createMockKysely([{ ...ledger }]);
        const ctx = createCtx(db);

        const rows = await ctx.transaction((trx) => trx.tvf('search_ledger', { q: 'x' }));

        expect(rows).toEqual([ledger]);
        expect(executedSql[0]).toContain('SELECT * FROM "search_ledger"(');

    });

    it('should return the first row from trx.func', async () => {

        const { db, executedSql } = createMockKysely([{ total: 99 }]);
        const ctx = createCtx(db);

        const result = await ctx.transaction((trx) => trx.func('calc_total', { order_id: 1 }, 'total'));

        expect(result).toEqual({ total: 99 });
        expect(executedSql[0]).toContain('"calc_total"(');

    });

    it('should accept a callback annotated with the plain Kysely Transaction type', async () => {

        const { db } = createMockKysely();
        const ctx = createCtx(db);
        const plain = async (trx: Transaction<LedgerDB>) => trx.isTransaction;

        expect(await ctx.transaction(plain)).toBe(true);

    });

    it('should type the handle routines off the context generics', () => {

        type Handle = TransactionScope<LedgerDB, TestProcs, TestFuncs, TestTvfs>;

        const _types = (trx: Handle) => {

            const _rows: Promise<Ledger[]> = trx.proc('rebuild_ledger', { id: 1 });
            const _total: Promise<{ total: number }> = trx.func('calc_total', { order_id: 1 }, 'total');
            const _found: Promise<Ledger[]> = trx.tvf('search_ledger', { q: 'x' });
            const _calls: RoutineCalls<TestProcs, TestFuncs, TestTvfs> = trx;
            const _trx: Transaction<LedgerDB> = trx;

            // @ts-expect-error 'nonexistent' is not a key of TestProcs
            trx.proc('nonexistent');

            // @ts-expect-error refresh_cache is void — no params allowed
            trx.proc('refresh_cache', { extra: true });

        };

        expect(_types).toBeDefined();

    });

});

describe('sdk: transaction handle schema qualification', () => {

    it('should qualify trx routine names with a derived context schema', async () => {

        const { db, executedSql } = createMockKysely();
        const acct = createCtx(db).withSchema<LedgerDB, TestProcs, TestFuncs, TestTvfs>('acct');

        Object.defineProperty(acct, 'kysely', { value: db, configurable: true });

        await acct.transaction(async (trx) => {

            await trx.tvf('search_ledger', { q: 'x' });
            await trx.func('calc_total', { order_id: 1 }, 'total');

        });

        expect(executedSql[0]).toContain('"acct"."search_ledger"(');
        expect(executedSql[1]).toContain('"acct"."calc_total"(');

    });

    it('should leave an already-qualified name alone', async () => {

        const { db, executedSql } = createMockKysely();
        const acct = createCtx(db).withSchema<LedgerDB, object, object, { 'other.search_ledger': [{ q: string }, Ledger] }>('acct');

        Object.defineProperty(acct, 'kysely', { value: db, configurable: true });

        await acct.transaction((trx) => trx.tvf('other.search_ledger', { q: 'x' }));

        expect(executedSql[0]).toContain('"other"."search_ledger"(');
        expect(executedSql[0]).not.toContain('"acct"');

    });

    it('should not qualify names on a root context', async () => {

        const { db, executedSql } = createMockKysely();
        const ctx = createCtx(db);

        await ctx.transaction((trx) => trx.tvf('search_ledger', { q: 'x' }));

        expect(executedSql[0]).toContain('FROM "search_ledger"(');

    });

});

describe('sdk: postgres proc catalog lookup', () => {

    it('should not query pg_proc outside a transaction', async () => {

        const { db, executedSql } = createMockKysely();
        const ctx = createCtx(db);

        await ctx.proc('refresh_cache');

        expect(executedSql).toEqual(['CALL "refresh_cache"()']);

    });

    it('should fall back from a failed CALL to SELECT outside a transaction', async () => {

        const { db, executedSql } = createMockKysely(
            [],
            (sql) => sql.startsWith('CALL') ? notAProcedure : null,
        );
        const ctx = createCtx(db);

        await ctx.proc('rebuild_ledger', { id: 1 });

        expect(executedSql).toEqual([
            'CALL "rebuild_ledger"("id" => $1)',
            'SELECT * FROM "rebuild_ledger"("id" => $1)',
        ]);

    });

    it('should CALL inside a transaction when the lookup finds a procedure', async () => {

        const { db, executedSql } = createMockKysely(lookupAnswers(true));
        const ctx = createCtx(db);

        await ctx.transaction((trx) => trx.proc('rebuild_ledger', { id: 1 }));

        expect(executedSql.map(isLookup)).toEqual([true, false]);
        expect(executedSql[1]).toBe('CALL "rebuild_ledger"("id" => $1)');

    });

    it('should SELECT inside a transaction when the lookup finds no procedure', async () => {

        const ledger: Ledger = { id: 1, amount: 10 };
        const { db, executedSql } = createMockKysely(lookupAnswers(false, [{ ...ledger }]));
        const ctx = createCtx(db);

        const rows = await ctx.transaction((trx) => trx.proc('rebuild_ledger', { id: 1 }));

        expect(rows).toEqual([ledger]);
        expect(executedSql.map(isLookup)).toEqual([true, false]);
        expect(executedSql[1]).toBe('SELECT * FROM "rebuild_ledger"("id" => $1)');

    });

    it('should look up a qualified name by its schema and proname', async () => {

        const { db, executedSql, executedParams } = createMockKysely(lookupAnswers(true));
        const acct = createCtx(db).withSchema<LedgerDB, TestProcs, TestFuncs, TestTvfs>('acct');

        Object.defineProperty(acct, 'kysely', { value: db, configurable: true });

        await acct.transaction((trx) => trx.proc('rebuild_ledger', { id: 1 }));

        expect(executedParams[0]).toEqual(['rebuild_ledger', 'acct']);
        expect(executedSql[0]).not.toContain('current_schemas');

    });

    it('should look up an unqualified name on the search path', async () => {

        const { db, executedSql, executedParams } = createMockKysely(lookupAnswers(true));
        const ctx = createCtx(db);

        await ctx.transaction((trx) => trx.proc('rebuild_ledger', { id: 1 }));

        expect(executedParams[0]).toEqual(['rebuild_ledger']);
        expect(executedSql[0]).toContain('current_schemas(false)');

    });

    it('should propagate a CALL error inside a transaction unchanged', async () => {

        const denied = Object.assign(new Error('permission denied for procedure rebuild_ledger'), { code: '42501' });
        const { db, executedSql } = createMockKysely(
            lookupAnswers(true),
            (sql) => sql.startsWith('CALL') ? denied : null,
        );
        const ctx = createCtx(db);

        const [, err] = await attempt(() => ctx.transaction((trx) => trx.proc('rebuild_ledger', { id: 1 })));

        expect(err).toBe(denied);
        expect(executedSql).toHaveLength(2);

    });

});

describe('sdk: impersonated scope transaction routines', () => {

    it('should pass the routine-carrying handle to scope.transaction', async () => {

        const ledger: Ledger = { id: 1, amount: 10 };
        const { db, executedSql } = createMockKysely([{ ...ledger }]);
        const scope = buildScope<LedgerDB, TestProcs, TestFuncs, TestTvfs>(db, async () => {}, 'postgres');

        const rows = await scope.transaction((trx) => trx.tvf('search_ledger', { q: 'x' }));

        expect(rows).toEqual([ledger]);
        expect(executedSql[0]).toContain('SELECT * FROM "search_ledger"(');

    });

    it('should give scope.proc the postgres FUNCTION fallback', async () => {

        const ledger: Ledger = { id: 1, amount: 10 };
        const { db, executedSql } = createMockKysely(
            [{ ...ledger }],
            (sql) => sql.startsWith('CALL') ? notAProcedure : null,
        );
        const scope = buildScope<LedgerDB, TestProcs>(db, async () => {}, 'postgres');

        const rows = await scope.proc('rebuild_ledger', { id: 1 });

        expect(rows).toEqual([ledger]);
        expect(executedSql).toEqual([
            'CALL "rebuild_ledger"("id" => $1)',
            'SELECT * FROM "rebuild_ledger"("id" => $1)',
        ]);

    });

});
