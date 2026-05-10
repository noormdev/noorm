/**
 * SQL builder tests.
 *
 * Verifies dialect-specific SQL generation for buildProcCall and
 * buildFuncCall by compiling RawBuilder output against each dialect's
 * query compiler.
 */
import { describe, it, expect } from 'bun:test';
import {
    Kysely,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
    MssqlAdapter,
    MssqlIntrospector,
    MssqlQueryCompiler,
    MysqlAdapter,
    MysqlIntrospector,
    MysqlQueryCompiler,
} from 'kysely';

import { buildProcCall, buildFuncCall, buildTvfCall } from '../../src/sdk/sql.js';
import { tvp } from '../../src/sdk/tvp.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function createKysely(dialect: 'postgres' | 'mssql' | 'mysql'): Kysely<unknown> {

    const adapters = {
        postgres: { adapter: PostgresAdapter, introspector: PostgresIntrospector, compiler: PostgresQueryCompiler },
        mssql: { adapter: MssqlAdapter, introspector: MssqlIntrospector, compiler: MssqlQueryCompiler },
        mysql: { adapter: MysqlAdapter, introspector: MysqlIntrospector, compiler: MysqlQueryCompiler },
    };

    const { adapter, introspector, compiler } = adapters[dialect];

    return new Kysely({
        dialect: {
            createAdapter: () => new adapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db: Kysely<unknown>) => new introspector(db),
            createQueryCompiler: () => new compiler(),
        },
    });

}

function compile(db: Kysely<unknown>, builder: ReturnType<typeof buildProcCall>) {

    const compiled = builder.compile(db);

    return { sql: compiled.sql, params: compiled.parameters };

}

const pgDb = createKysely('postgres');
const mssqlDb = createKysely('mssql');
const mysqlDb = createKysely('mysql');

// ─────────────────────────────────────────────────────────────
// buildProcCall
// ─────────────────────────────────────────────────────────────

describe('sdk: buildProcCall', () => {

    describe('mssql', () => {

        it('should generate EXEC with named params', () => {

            const q = buildProcCall('mssql', 'get_users', { department_id: 1, active: true });
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('EXEC [get_users] @department_id = @1, @active = @2');
            expect(params).toEqual([1, true]);

        });

        it('should generate EXEC with positional params', () => {

            const q = buildProcCall('mssql', 'get_users', [1, 'admin']);
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('EXEC [get_users] @1, @2');
            expect(params).toEqual([1, 'admin']);

        });

        it('should generate EXEC with no params', () => {

            const q = buildProcCall('mssql', 'refresh_cache');
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('EXEC [refresh_cache]');
            expect(params).toEqual([]);

        });

    });

    describe('postgres', () => {

        it('should generate CALL with named params', () => {

            const q = buildProcCall('postgres', 'get_users', { department_id: 1, active: true });
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('CALL "get_users"("department_id" => $1, "active" => $2)');
            expect(params).toEqual([1, true]);

        });

        it('should generate CALL with positional params', () => {

            const q = buildProcCall('postgres', 'get_users', [1, 'admin']);
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('CALL "get_users"($1, $2)');
            expect(params).toEqual([1, 'admin']);

        });

        it('should generate CALL with no params', () => {

            const q = buildProcCall('postgres', 'refresh_cache');
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('CALL "refresh_cache"()');
            expect(params).toEqual([]);

        });

    });

    describe('mysql', () => {

        it('should fall back named params to positional', () => {

            const q = buildProcCall('mysql', 'get_users', { department_id: 1, active: true });
            const { sql, params } = compile(mysqlDb, q);

            expect(sql).toBe('CALL `get_users`(?, ?)');
            expect(params).toEqual([1, true]);

        });

        it('should generate CALL with positional params', () => {

            const q = buildProcCall('mysql', 'get_users', [1, 'admin']);
            const { sql, params } = compile(mysqlDb, q);

            expect(sql).toBe('CALL `get_users`(?, ?)');
            expect(params).toEqual([1, 'admin']);

        });

        it('should generate CALL with no params', () => {

            const q = buildProcCall('mysql', 'refresh_cache');
            const { sql, params } = compile(mysqlDb, q);

            expect(sql).toBe('CALL `refresh_cache`()');
            expect(params).toEqual([]);

        });

    });

    describe('sqlite', () => {

        it('should throw for stored procedures', () => {

            expect(() => buildProcCall('sqlite', 'any_proc')).toThrow(
                'SQLite does not support stored procedures.',
            );

        });

    });

    describe('tvp (table-valued parameters)', () => {

        it('should generate DECLARE/INSERT/EXEC with named params', () => {

            const q = buildProcCall('mssql', 'Checkout_trx', {
                Party: 1,
                PaymentMethod: 2,
                Items: tvp('CheckoutItems', [
                    { Type: 1, ReferenceNo: 100, Qty: 5 },
                    { Type: 2, ReferenceNo: 200, Qty: 3 },
                ]),
            });
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_Items CheckoutItems; ' +
                'INSERT INTO @__tvp_Items ([Type], [ReferenceNo], [Qty]) VALUES (@1, @2, @3), (@4, @5, @6); ' +
                'EXEC [Checkout_trx] @Party = @7, @PaymentMethod = @8, @Items = @__tvp_Items',
            );
            expect(params).toEqual([1, 100, 5, 2, 200, 3, 1, 2]);

        });

        it('should generate DECLARE/INSERT/EXEC with positional params', () => {

            const q = buildProcCall('mssql', 'Checkout_trx', [
                1,
                2,
                tvp('CheckoutItems', [
                    { Type: 1, ReferenceNo: 100, Qty: 5 },
                ]),
            ]);
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_2 CheckoutItems; ' +
                'INSERT INTO @__tvp_2 ([Type], [ReferenceNo], [Qty]) VALUES (@1, @2, @3); ' +
                'EXEC [Checkout_trx] @4, @5, @__tvp_2',
            );
            expect(params).toEqual([1, 100, 5, 1, 2]);

        });

        it('should handle empty TVP rows (passes empty table)', () => {

            const q = buildProcCall('mssql', 'Checkout_trx', {
                Party: 1,
                Items: tvp('CheckoutItems', []),
            });
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_Items CheckoutItems; ' +
                'EXEC [Checkout_trx] @Party = @1, @Items = @__tvp_Items',
            );
            expect(params).toEqual([1]);

        });

        it('should handle multiple TVP params', () => {

            const q = buildProcCall('mssql', 'BulkProcess', {
                BatchId: 42,
                Orders: tvp('OrderType', [{ id: 1 }]),
                Items: tvp('ItemType', [{ sku: 'A' }]),
            });
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_Orders OrderType; ' +
                'INSERT INTO @__tvp_Orders ([id]) VALUES (@1); ' +
                'DECLARE @__tvp_Items ItemType; ' +
                'INSERT INTO @__tvp_Items ([sku]) VALUES (@2); ' +
                'EXEC [BulkProcess] @BatchId = @3, @Orders = @__tvp_Orders, @Items = @__tvp_Items',
            );
            expect(params).toEqual([1, 'A', 42]);

        });

        it('should handle multiple TVP params positional', () => {

            const q = buildProcCall('mssql', 'BulkProcess', [
                42,
                tvp('OrderType', [{ id: 1 }]),
                tvp('ItemType', [{ sku: 'A' }, { sku: 'B' }]),
            ]);
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_1 OrderType; ' +
                'INSERT INTO @__tvp_1 ([id]) VALUES (@1); ' +
                'DECLARE @__tvp_2 ItemType; ' +
                'INSERT INTO @__tvp_2 ([sku]) VALUES (@2), (@3); ' +
                'EXEC [BulkProcess] @4, @__tvp_1, @__tvp_2',
            );
            expect(params).toEqual([1, 'A', 'B', 42]);

        });

        it('should support schema-qualified type names', () => {

            const q = buildProcCall('mssql', 'MyProc', {
                Data: tvp('dbo.MyTableType', [{ val: 1 }]),
            });
            const { sql } = compile(mssqlDb, q);

            expect(sql).toContain('DECLARE @__tvp_Data dbo.MyTableType');

        });

        it('should throw for TVP on postgres', () => {

            expect(() => buildProcCall('postgres', 'any_proc', {
                Items: tvp('MyType', [{ id: 1 }]),
            })).toThrow('Table-valued parameters (TVP) are only supported on MSSQL.');

        });

        it('should throw for TVP on mysql', () => {

            expect(() => buildProcCall('mysql', 'any_proc', [
                tvp('MyType', [{ id: 1 }]),
            ])).toThrow('Table-valued parameters (TVP) are only supported on MSSQL.');

        });

    });

});

// ─────────────────────────────────────────────────────────────
// buildFuncCall
// ─────────────────────────────────────────────────────────────

describe('sdk: buildFuncCall', () => {

    describe('mssql', () => {

        it('should use EXEC pattern for named params', () => {

            const q = buildFuncCall('mssql', 'calc_total', 'total', { order_id: 42 });
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('DECLARE @__result sql_variant; EXEC @__result = [calc_total] @order_id = @1; SELECT @__result AS [total]');
            expect(params).toEqual([42]);

        });

        it('should generate SELECT with positional params', () => {

            const q = buildFuncCall('mssql', 'add_numbers', 'result', [1, 2]);
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('SELECT [add_numbers](@1, @2) AS [result]');
            expect(params).toEqual([1, 2]);

        });

        it('should generate SELECT with no params', () => {

            const q = buildFuncCall('mssql', 'get_version', 'v');
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('SELECT [get_version]() AS [v]');
            expect(params).toEqual([]);

        });

    });

    describe('postgres', () => {

        it('should generate SELECT with named params', () => {

            const q = buildFuncCall('postgres', 'calc_total', 'total', { order_id: 42 });
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('SELECT "calc_total"("order_id" => $1) AS "total"');
            expect(params).toEqual([42]);

        });

        it('should generate SELECT with positional params', () => {

            const q = buildFuncCall('postgres', 'add_numbers', 'result', [1, 2]);
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('SELECT "add_numbers"($1, $2) AS "result"');
            expect(params).toEqual([1, 2]);

        });

        it('should generate SELECT with no params', () => {

            const q = buildFuncCall('postgres', 'get_version', 'v');
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('SELECT "get_version"() AS "v"');
            expect(params).toEqual([]);

        });

    });

    describe('mysql', () => {

        it('should throw for named params (objects)', () => {

            expect(() => buildFuncCall('mysql', 'calc_total', 'total', { order_id: 42 })).toThrow(
                'MySQL does not support named parameters in function calls. Use positional parameters (array) instead.',
            );

        });

        it('should generate SELECT with positional params', () => {

            const q = buildFuncCall('mysql', 'add_numbers', 'result', [1, 2]);
            const { sql, params } = compile(mysqlDb, q);

            expect(sql).toBe('SELECT `add_numbers`(?, ?) AS `result`');
            expect(params).toEqual([1, 2]);

        });

        it('should generate SELECT with no params', () => {

            const q = buildFuncCall('mysql', 'get_version', 'v');
            const { sql, params } = compile(mysqlDb, q);

            expect(sql).toBe('SELECT `get_version`() AS `v`');
            expect(params).toEqual([]);

        });

    });

    describe('sqlite', () => {

        it('should throw for database functions', () => {

            expect(() => buildFuncCall('sqlite', 'any_func', 'col')).toThrow(
                'SQLite does not support database function calls.',
            );

        });

    });

    describe('tvp (table-valued parameters)', () => {

        it('should generate DECLARE/INSERT/EXEC for func with named TVP params', () => {

            const q = buildFuncCall('mssql', 'score_items', 'total', {
                multiplier: 2,
                Items: tvp('ItemType', [
                    { val: 10 },
                    { val: 20 },
                ]),
            });
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_Items ItemType; ' +
                'INSERT INTO @__tvp_Items ([val]) VALUES (@1), (@2); ' +
                'DECLARE @__result sql_variant; EXEC @__result = [score_items] @multiplier = @3, @Items = @__tvp_Items; SELECT @__result AS [total]',
            );
            expect(params).toEqual([10, 20, 2]);

        });

        it('should generate DECLARE/INSERT/EXEC for func with positional TVP params', () => {

            const q = buildFuncCall('mssql', 'score_items', 'total', [
                2,
                tvp('ItemType', [{ val: 10 }]),
            ]);
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_1 ItemType; ' +
                'INSERT INTO @__tvp_1 ([val]) VALUES (@1); ' +
                'DECLARE @__result sql_variant; EXEC @__result = [score_items] @2, @__tvp_1; SELECT @__result AS [total]',
            );
            expect(params).toEqual([10, 2]);

        });

        it('should handle multiple TVP params named', () => {

            const q = buildFuncCall('mssql', 'combine_scores', 'total', {
                A: tvp('TypeA', [{ x: 1 }]),
                B: tvp('TypeB', [{ y: 2 }]),
            });
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_A TypeA; ' +
                'INSERT INTO @__tvp_A ([x]) VALUES (@1); ' +
                'DECLARE @__tvp_B TypeB; ' +
                'INSERT INTO @__tvp_B ([y]) VALUES (@2); ' +
                'DECLARE @__result sql_variant; EXEC @__result = [combine_scores] @A = @__tvp_A, @B = @__tvp_B; SELECT @__result AS [total]',
            );
            expect(params).toEqual([1, 2]);

        });

        it('should handle multiple TVP params positional', () => {

            const q = buildFuncCall('mssql', 'combine_scores', 'total', [
                tvp('TypeA', [{ x: 1 }]),
                tvp('TypeB', [{ y: 2 }]),
            ]);
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_0 TypeA; ' +
                'INSERT INTO @__tvp_0 ([x]) VALUES (@1); ' +
                'DECLARE @__tvp_1 TypeB; ' +
                'INSERT INTO @__tvp_1 ([y]) VALUES (@2); ' +
                'DECLARE @__result sql_variant; EXEC @__result = [combine_scores] @__tvp_0, @__tvp_1; SELECT @__result AS [total]',
            );
            expect(params).toEqual([1, 2]);

        });

        it('should throw for TVP on postgres func', () => {

            expect(() => buildFuncCall('postgres', 'any_func', 'col', {
                Items: tvp('MyType', [{ id: 1 }]),
            })).toThrow('Table-valued parameters (TVP) are only supported on MSSQL.');

        });

    });

});

// ─────────────────────────────────────────────────────────────
// buildTvfCall
// ─────────────────────────────────────────────────────────────

describe('sdk: buildTvfCall', () => {

    describe('mssql', () => {

        it('should generate SELECT * FROM with named params (flattened to positional)', () => {

            const q = buildTvfCall('mssql', 'validate_session', { session_key: 'abc' });
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('SELECT * FROM [validate_session](@1)');
            expect(params).toEqual(['abc']);

        });

        it('should generate SELECT * FROM with positional params', () => {

            const q = buildTvfCall('mssql', 'search_products', ['widget', 100]);
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('SELECT * FROM [search_products](@1, @2)');
            expect(params).toEqual(['widget', 100]);

        });

        it('should generate SELECT * FROM with no params', () => {

            const q = buildTvfCall('mssql', 'get_active_items');
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('SELECT * FROM [get_active_items]()');
            expect(params).toEqual([]);

        });

    });

    describe('postgres', () => {

        it('should generate SELECT * FROM with named params', () => {

            const q = buildTvfCall('postgres', 'validate_session', { session_key: 'abc' });
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('SELECT * FROM "validate_session"("session_key" => $1)');
            expect(params).toEqual(['abc']);

        });

        it('should generate SELECT * FROM with positional params', () => {

            const q = buildTvfCall('postgres', 'search_products', ['widget', 100]);
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('SELECT * FROM "search_products"($1, $2)');
            expect(params).toEqual(['widget', 100]);

        });

        it('should generate SELECT * FROM with no params', () => {

            const q = buildTvfCall('postgres', 'get_active_items');
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('SELECT * FROM "get_active_items"()');
            expect(params).toEqual([]);

        });

    });

    describe('mysql', () => {

        it('should throw for table-valued functions', () => {

            expect(() => buildTvfCall('mysql', 'any_tvf')).toThrow(
                'MySQL does not support table-valued functions.',
            );

        });

    });

    describe('sqlite', () => {

        it('should throw for table-valued functions', () => {

            expect(() => buildTvfCall('sqlite', 'any_tvf')).toThrow(
                'SQLite does not support table-valued functions.',
            );

        });

    });

    describe('tvp (table-valued parameters)', () => {

        it('should generate DECLARE/INSERT/SELECT FROM for tvf with named TVP params', () => {

            const q = buildTvfCall('mssql', 'expand_items', {
                batch_id: 42,
                Items: tvp('ItemType', [
                    { val: 10 },
                ]),
            });
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_Items ItemType; ' +
                'INSERT INTO @__tvp_Items ([val]) VALUES (@1); ' +
                'SELECT * FROM [expand_items](@2, @__tvp_Items)',
            );
            expect(params).toEqual([10, 42]);

        });

        it('should generate DECLARE/INSERT/SELECT FROM for tvf with positional TVP params', () => {

            const q = buildTvfCall('mssql', 'expand_items', [
                42,
                tvp('ItemType', [{ val: 10 }, { val: 20 }]),
            ]);
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_1 ItemType; ' +
                'INSERT INTO @__tvp_1 ([val]) VALUES (@1), (@2); ' +
                'SELECT * FROM [expand_items](@3, @__tvp_1)',
            );
            expect(params).toEqual([10, 20, 42]);

        });

        it('should handle multiple TVP params named', () => {

            const q = buildTvfCall('mssql', 'cross_join_tvps', {
                A: tvp('TypeA', [{ x: 1 }]),
                B: tvp('TypeB', [{ y: 2 }]),
            });
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_A TypeA; ' +
                'INSERT INTO @__tvp_A ([x]) VALUES (@1); ' +
                'DECLARE @__tvp_B TypeB; ' +
                'INSERT INTO @__tvp_B ([y]) VALUES (@2); ' +
                'SELECT * FROM [cross_join_tvps](@__tvp_A, @__tvp_B)',
            );
            expect(params).toEqual([1, 2]);

        });

        it('should handle multiple TVP params positional', () => {

            const q = buildTvfCall('mssql', 'cross_join_tvps', [
                tvp('TypeA', [{ x: 1 }]),
                42,
                tvp('TypeB', [{ y: 2 }]),
            ]);
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe(
                'DECLARE @__tvp_0 TypeA; ' +
                'INSERT INTO @__tvp_0 ([x]) VALUES (@1); ' +
                'DECLARE @__tvp_2 TypeB; ' +
                'INSERT INTO @__tvp_2 ([y]) VALUES (@2); ' +
                'SELECT * FROM [cross_join_tvps](@__tvp_0, @3, @__tvp_2)',
            );
            expect(params).toEqual([1, 2, 42]);

        });

        it('should throw for TVP on postgres tvf', () => {

            expect(() => buildTvfCall('postgres', 'any_tvf', {
                Items: tvp('MyType', [{ id: 1 }]),
            })).toThrow('Table-valued parameters (TVP) are only supported on MSSQL.');

        });

    });

});

// ─────────────────────────────────────────────────────────────
// TVP Validation
// ─────────────────────────────────────────────────────────────

describe('sdk: tvp() validation', () => {

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
        ])).toThrow('TVP row 1 has mismatched keys. Expected [a, b] but got [a, c].');

    });

    it('should accept rows with same keys in different order', () => {

        // Keys are sorted before comparison, so order doesn't matter
        expect(() => tvp('MyType', [
            { b: 2, a: 1 },
            { a: 1, b: 2 },
        ])).not.toThrow();

    });

    it('should accept single-row TVP without validation', () => {

        expect(() => tvp('MyType', [{ a: 1 }])).not.toThrow();

    });

    it('should accept empty rows', () => {

        expect(() => tvp('MyType', [])).not.toThrow();

    });

});

describe('sdk: TVP parameter count limit', () => {

    it('should throw when TVP params exceed 2100 limit', () => {

        // 700 rows * 3 columns = 2100, plus 1 scalar = 2101
        const rows = Array.from({ length: 700 }, (_, i) => ({ a: i, b: i, c: i }));

        expect(() => buildProcCall('mssql', 'big_proc', {
            scalar: 1,
            Items: tvp('BigType', rows),
        })).toThrow('TVP parameter count (2101) exceeds MSSQL limit of 2100');

    });

    it('should not throw at exactly 2100 params', () => {

        // 700 rows * 3 columns = 2100 exactly
        const rows = Array.from({ length: 700 }, (_, i) => ({ a: i, b: i, c: i }));

        expect(() => buildProcCall('mssql', 'big_proc', {
            Items: tvp('BigType', rows),
        })).not.toThrow();

    });

    it('should count params across multiple TVPs', () => {

        // 600 * 2 = 1200 + 600 * 2 = 1200 = 2400 total → exceeds
        const rows1 = Array.from({ length: 600 }, (_, i) => ({ a: i, b: i }));
        const rows2 = Array.from({ length: 600 }, (_, i) => ({ x: i, y: i }));

        expect(() => buildProcCall('mssql', 'big_proc', {
            A: tvp('Type1', rows1),
            B: tvp('Type2', rows2),
        })).toThrow('TVP parameter count (2400) exceeds MSSQL limit of 2100');

    });

    it('should validate param count for func calls too', () => {

        const rows = Array.from({ length: 800 }, (_, i) => ({ a: i, b: i, c: i }));

        expect(() => buildFuncCall('mssql', 'big_func', 'result', {
            Items: tvp('BigType', rows),
        })).toThrow('exceeds MSSQL limit of 2100');

    });

    it('should validate param count for tvf calls too', () => {

        const rows = Array.from({ length: 800 }, (_, i) => ({ a: i, b: i, c: i }));

        expect(() => buildTvfCall('mssql', 'big_tvf', {
            Items: tvp('BigType', rows),
        })).toThrow('exceeds MSSQL limit of 2100');

    });

});

// ─────────────────────────────────────────────────────────────
// Identifier Quoting (regression: PG case-folding bug)
// ─────────────────────────────────────────────────────────────

describe('sdk: identifier quoting', () => {

    describe('postgres', () => {

        it('should quote CamelCase proc name', () => {

            const q = buildProcCall('postgres', 'sp_Memory_Create', { content: 'x' });
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('CALL "sp_Memory_Create"("content" => $1)');
            expect(params).toEqual(['x']);

        });

        it('should quote CamelCase func name and column alias', () => {

            const q = buildFuncCall('postgres', 'fn_MemoryRank', 'rank', { memory_id: 1 });
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('SELECT "fn_MemoryRank"("memory_id" => $1) AS "rank"');
            expect(params).toEqual([1]);

        });

        it('should quote CamelCase TVF name', () => {

            const q = buildTvfCall('postgres', 'tvf_GetUsers', { user_id: 'x' });
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('SELECT * FROM "tvf_GetUsers"("user_id" => $1)');
            expect(params).toEqual(['x']);

        });

        it('should quote schema-qualified names independently', () => {

            const q = buildProcCall('postgres', 'public.sp_X', { foo: 1 });
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('CALL "public"."sp_X"("foo" => $1)');
            expect(params).toEqual([1]);

        });

        it('should escape embedded double quotes in name', () => {

            const q = buildProcCall('postgres', 'sp_"Weird"', {});
            const { sql } = compile(pgDb, q);

            expect(sql).toBe('CALL "sp_""Weird"""()');

        });

        it('should quote CamelCase named-arg keys', () => {

            const q = buildProcCall('postgres', 'sp_X', { ParamName: 1 });
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('CALL "sp_X"("ParamName" => $1)');
            expect(params).toEqual([1]);

        });

        it('should quote name in empty-params branch', () => {

            const q = buildProcCall('postgres', 'sp_X');
            const { sql } = compile(pgDb, q);

            expect(sql).toBe('CALL "sp_X"()');

        });

    });

    describe('mssql', () => {

        it('should quote CamelCase proc name', () => {

            const q = buildProcCall('mssql', 'sp_Get_Users', { id: 1 });
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('EXEC [sp_Get_Users] @id = @1');
            expect(params).toEqual([1]);

        });

        it('should quote schema-qualified names independently', () => {

            const q = buildProcCall('mssql', 'dbo.sp_X');
            const { sql } = compile(mssqlDb, q);

            expect(sql).toBe('EXEC [dbo].[sp_X]');

        });

        it('should escape embedded close-bracket in name', () => {

            const q = buildProcCall('mssql', 'sp_]X');
            const { sql } = compile(mssqlDb, q);

            expect(sql).toBe('EXEC [sp_]]X]');

        });

        it('should quote name in empty-params branch', () => {

            const q = buildProcCall('mssql', 'sp_X');
            const { sql } = compile(mssqlDb, q);

            expect(sql).toBe('EXEC [sp_X]');

        });

    });

    describe('mysql', () => {

        it('should quote CamelCase proc name', () => {

            const q = buildProcCall('mysql', 'sp_Get_Users', [1, 2]);
            const { sql, params } = compile(mysqlDb, q);

            expect(sql).toBe('CALL `sp_Get_Users`(?, ?)');
            expect(params).toEqual([1, 2]);

        });

        it('should escape embedded backtick in name', () => {

            const q = buildProcCall('mysql', 'sp_`X', [1]);
            const { sql } = compile(mysqlDb, q);

            expect(sql).toBe('CALL `sp_``X`(?)');

        });

        it('should quote name in empty-params branch', () => {

            const q = buildProcCall('mysql', 'sp_X');
            const { sql } = compile(mysqlDb, q);

            expect(sql).toBe('CALL `sp_X`()');

        });

    });

    describe('Kysely table-name quoting (smoke tests)', () => {

        it('Kysely selectFrom quotes CamelCase table names (postgres)', () => {

            // cast-justified: testing the SQL compiler, not the type system
            const compiled = pgDb.selectFrom('vw_Memory' as never).selectAll().compile();

            expect(compiled.sql).toContain('"vw_Memory"');

        });

        it('Kysely selectFrom quotes CamelCase table names (mssql)', () => {

            // cast-justified: testing the SQL compiler, not the type system
            const compiled = mssqlDb.selectFrom('vw_Memory' as never).selectAll().compile();

            // Kysely's MssqlQueryCompiler uses ANSI double-quote identifiers
            // (works under QUOTED_IDENTIFIER ON, the SQL Server default).
            expect(compiled.sql).toContain('"vw_Memory"');

        });

        it('Kysely selectFrom quotes CamelCase table names (mysql)', () => {

            // cast-justified: testing the SQL compiler, not the type system
            const compiled = mysqlDb.selectFrom('vw_Memory' as never).selectAll().compile();

            expect(compiled.sql).toContain('`vw_Memory`');

        });

    });

});

// ─────────────────────────────────────────────────────────────
// PG proc fallback (CALL → SELECT * FROM when target is a FUNCTION)
// ─────────────────────────────────────────────────────────────

describe('PG proc fallback to SELECT * FROM (function path)', () => {

    it('buildTvfCall produces the correct SELECT * FROM shape used by the proc fallback', () => {

        const q = buildTvfCall('postgres', 'sp_Memory_Create', { p_content: 'x', p_domain: 'backend' });
        const { sql, params } = compile(pgDb, q);

        expect(sql).toBe('SELECT * FROM "sp_Memory_Create"("p_content" => $1, "p_domain" => $2)');
        expect(params).toEqual(['x', 'backend']);

    });

    it('error detection: identifies "is not a procedure" error', () => {

        // Local copy of the predicate to verify its shape (the real one is
        // module-private inside context.ts; tests don't need to import it).
        const isFnErr = (err: { code?: string; message?: string }) =>
            err.code === '42809' && String(err.message ?? '').includes('is not a procedure');

        expect(isFnErr({ code: '42809', message: 'sp_X is not a procedure' })).toBe(true);
        expect(isFnErr({ code: '42883', message: 'function does not exist' })).toBe(false);
        expect(isFnErr({ code: '42809', message: 'permission denied' })).toBe(false);
        expect(isFnErr({})).toBe(false);

    });

});
