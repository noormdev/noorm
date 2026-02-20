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

import { buildProcCall, buildFuncCall } from '../../src/sdk/sql.js';

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

            expect(sql).toBe('EXEC get_users @department_id = @1, @active = @2');
            expect(params).toEqual([1, true]);

        });

        it('should generate EXEC with positional params', () => {

            const q = buildProcCall('mssql', 'get_users', [1, 'admin']);
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('EXEC get_users @1, @2');
            expect(params).toEqual([1, 'admin']);

        });

        it('should generate EXEC with no params', () => {

            const q = buildProcCall('mssql', 'refresh_cache');
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('EXEC refresh_cache');
            expect(params).toEqual([]);

        });

    });

    describe('postgres', () => {

        it('should generate CALL with named params', () => {

            const q = buildProcCall('postgres', 'get_users', { department_id: 1, active: true });
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('CALL get_users(department_id => $1, active => $2)');
            expect(params).toEqual([1, true]);

        });

        it('should generate CALL with positional params', () => {

            const q = buildProcCall('postgres', 'get_users', [1, 'admin']);
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('CALL get_users($1, $2)');
            expect(params).toEqual([1, 'admin']);

        });

        it('should generate CALL with no params', () => {

            const q = buildProcCall('postgres', 'refresh_cache');
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('CALL refresh_cache()');
            expect(params).toEqual([]);

        });

    });

    describe('mysql', () => {

        it('should fall back named params to positional', () => {

            const q = buildProcCall('mysql', 'get_users', { department_id: 1, active: true });
            const { sql, params } = compile(mysqlDb, q);

            expect(sql).toBe('CALL get_users(?, ?)');
            expect(params).toEqual([1, true]);

        });

        it('should generate CALL with positional params', () => {

            const q = buildProcCall('mysql', 'get_users', [1, 'admin']);
            const { sql, params } = compile(mysqlDb, q);

            expect(sql).toBe('CALL get_users(?, ?)');
            expect(params).toEqual([1, 'admin']);

        });

        it('should generate CALL with no params', () => {

            const q = buildProcCall('mysql', 'refresh_cache');
            const { sql, params } = compile(mysqlDb, q);

            expect(sql).toBe('CALL refresh_cache()');
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

});

// ─────────────────────────────────────────────────────────────
// buildFuncCall
// ─────────────────────────────────────────────────────────────

describe('sdk: buildFuncCall', () => {

    describe('mssql', () => {

        it('should use EXEC pattern for named params', () => {

            const q = buildFuncCall('mssql', 'calc_total', 'total', { order_id: 42 });
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('DECLARE @__result sql_variant; EXEC @__result = calc_total @order_id = @1; SELECT @__result AS total');
            expect(params).toEqual([42]);

        });

        it('should generate SELECT with positional params', () => {

            const q = buildFuncCall('mssql', 'add_numbers', 'result', [1, 2]);
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('SELECT add_numbers(@1, @2) AS result');
            expect(params).toEqual([1, 2]);

        });

        it('should generate SELECT with no params', () => {

            const q = buildFuncCall('mssql', 'get_version', 'v');
            const { sql, params } = compile(mssqlDb, q);

            expect(sql).toBe('SELECT get_version() AS v');
            expect(params).toEqual([]);

        });

    });

    describe('postgres', () => {

        it('should generate SELECT with named params', () => {

            const q = buildFuncCall('postgres', 'calc_total', 'total', { order_id: 42 });
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('SELECT calc_total(order_id => $1) AS total');
            expect(params).toEqual([42]);

        });

        it('should generate SELECT with positional params', () => {

            const q = buildFuncCall('postgres', 'add_numbers', 'result', [1, 2]);
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('SELECT add_numbers($1, $2) AS result');
            expect(params).toEqual([1, 2]);

        });

        it('should generate SELECT with no params', () => {

            const q = buildFuncCall('postgres', 'get_version', 'v');
            const { sql, params } = compile(pgDb, q);

            expect(sql).toBe('SELECT get_version() AS v');
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

            expect(sql).toBe('SELECT add_numbers(?, ?) AS result');
            expect(params).toEqual([1, 2]);

        });

        it('should generate SELECT with no params', () => {

            const q = buildFuncCall('mysql', 'get_version', 'v');
            const { sql, params } = compile(mysqlDb, q);

            expect(sql).toBe('SELECT get_version() AS v');
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

});
