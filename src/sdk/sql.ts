/**
 * Dialect-aware SQL builders for stored procedures and functions.
 *
 * Generates parameterized Kysely RawBuilder instances with proper
 * dialect-specific syntax for EXEC/CALL and SELECT function calls.
 * Values are always bound as parameters to prevent SQL injection.
 */
import { sql } from 'kysely';

import type { RawBuilder } from 'kysely';
import type { Dialect } from '../core/connection/types.js';

// ─────────────────────────────────────────────────────────────
// Stored Procedure Builder
// ─────────────────────────────────────────────────────────────

/**
 * Build a dialect-specific stored procedure call.
 *
 * Generates EXEC (MSSQL) or CALL (PG/MySQL) with proper named
 * or positional parameter syntax. SQLite throws — no procedure support.
 *
 * @example
 * ```typescript
 * // Named params on MSSQL → EXEC get_users @department_id = $1, @active = $2
 * buildProcCall('mssql', 'get_users', { department_id: 1, active: true });
 *
 * // Named params on PG → CALL get_users(department_id => $1, active => $2)
 * buildProcCall('postgres', 'get_users', { department_id: 1, active: true });
 *
 * // Positional on MySQL → CALL get_users(?, ?)
 * buildProcCall('mysql', 'get_users', [1, true]);
 * ```
 */
export function buildProcCall<T = unknown>(
    dialect: Dialect,
    name: string,
    params?: Record<string, unknown> | unknown[],
): RawBuilder<T> {

    if (dialect === 'sqlite') {

        throw new Error('SQLite does not support stored procedures.');

    }

    const rawName = sql.raw(name);

    if (!params || (Array.isArray(params) && params.length === 0) || (!Array.isArray(params) && Object.keys(params).length === 0)) {

        if (dialect === 'mssql') {

            return sql<T>`EXEC ${rawName}`;

        }

        return sql<T>`CALL ${rawName}()`;

    }

    if (dialect === 'mssql') {

        return buildMssqlProc<T>(rawName, params);

    }

    if (dialect === 'postgres') {

        return buildPostgresProc<T>(rawName, params);

    }

    // MySQL — always positional
    return buildMysqlProc<T>(rawName, params);

}

// ─────────────────────────────────────────────────────────────
// Database Function Builder
// ─────────────────────────────────────────────────────────────

/**
 * Build a dialect-specific database function call as a SELECT.
 *
 * Generates SELECT name(...) AS column. Named params only on PG;
 * other dialects fall back to positional. SQLite throws.
 *
 * @example
 * ```typescript
 * // PG named → SELECT calc_total(order_id => $1) AS total
 * buildFuncCall('postgres', 'calc_total', 'total', { order_id: 42 });
 *
 * // MSSQL named → DECLARE @__result sql_variant; EXEC @__result = calc_total @order_id = @1; SELECT @__result AS total
 * buildFuncCall('mssql', 'calc_total', 'total', { order_id: 42 });
 *
 * // MSSQL positional → SELECT calc_total(@1) AS total
 * buildFuncCall('mssql', 'calc_total', 'total', [42]);
 * ```
 */
export function buildFuncCall<T = unknown>(
    dialect: Dialect,
    name: string,
    column: string,
    params?: Record<string, unknown> | unknown[],
): RawBuilder<T> {

    if (dialect === 'sqlite') {

        throw new Error('SQLite does not support database function calls.');

    }

    const rawName = sql.raw(name);
    const rawCol = sql.raw(column);

    if (!params || (Array.isArray(params) && params.length === 0) || (!Array.isArray(params) && Object.keys(params).length === 0)) {

        return sql<T>`SELECT ${rawName}() AS ${rawCol}`;

    }

    // PG supports named params in function calls
    if (dialect === 'postgres' && !Array.isArray(params)) {

        const parts = Object.entries(params).map(([key, val]) =>
            sql`${sql.raw(key)} => ${val}`,
        );

        return sql<T>`SELECT ${rawName}(${sql.join(parts)}) AS ${rawCol}`;

    }

    // MSSQL named params — use EXEC pattern with sql_variant capture
    // SELECT dbo.func(...) doesn't support named params in T-SQL,
    // but EXEC @var = func @key = val does. This avoids silent
    // mis-ordering when the user passes an object.
    if (dialect === 'mssql' && !Array.isArray(params)) {

        const parts = Object.entries(params).map(([key, val]) =>
            sql`${sql.raw(`@${key}`)} = ${val}`,
        );

        return sql<T>`DECLARE @__result sql_variant; EXEC @__result = ${rawName} ${sql.join(parts)}; SELECT @__result AS ${rawCol}`;

    }

    // MySQL does not support named params — reject objects
    if (dialect === 'mysql' && !Array.isArray(params)) {

        throw new Error('MySQL does not support named parameters in function calls. Use positional parameters (array) instead.');

    }

    // Positional — MSSQL arrays, MySQL arrays
    const values = Array.isArray(params) ? params : Object.values(params);
    const joined = sql.join(values.map((v) => sql`${v}`));

    return sql<T>`SELECT ${rawName}(${joined}) AS ${rawCol}`;

}

// ─────────────────────────────────────────────────────────────
// Table-Valued Function Builder
// ─────────────────────────────────────────────────────────────

/**
 * Build a dialect-specific table-valued function call.
 *
 * Generates SELECT * FROM name(...) with proper parameter syntax.
 * TVFs return result sets (multiple rows), unlike scalar functions.
 * Only supported on MSSQL and PostgreSQL — MySQL and SQLite throw.
 *
 * @example
 * ```typescript
 * // PG named → SELECT * FROM validate_session(session_key => $1)
 * buildTvfCall('postgres', 'validate_session', { session_key: 'abc' });
 *
 * // MSSQL named → SELECT * FROM validate_session(@1)
 * buildTvfCall('mssql', 'validate_session', { session_key: 'abc' });
 *
 * // Positional → SELECT * FROM validate_session($1)
 * buildTvfCall('postgres', 'validate_session', ['abc']);
 * ```
 */
export function buildTvfCall<T = unknown>(
    dialect: Dialect,
    name: string,
    params?: Record<string, unknown> | unknown[],
): RawBuilder<T> {

    if (dialect === 'sqlite') {

        throw new Error('SQLite does not support table-valued functions.');

    }

    if (dialect === 'mysql') {

        throw new Error('MySQL does not support table-valued functions.');

    }

    const rawName = sql.raw(name);

    if (!params || (Array.isArray(params) && params.length === 0) || (!Array.isArray(params) && Object.keys(params).length === 0)) {

        return sql<T>`SELECT * FROM ${rawName}()`;

    }

    // PG supports named params in FROM clause
    if (dialect === 'postgres' && !Array.isArray(params)) {

        const parts = Object.entries(params).map(([key, val]) =>
            sql`${sql.raw(key)} => ${val}`,
        );

        return sql<T>`SELECT * FROM ${rawName}(${sql.join(parts)})`;

    }

    // MSSQL + positional — FROM clause only takes positional values
    const values = Array.isArray(params) ? params : Object.values(params);
    const joined = sql.join(values.map((v) => sql`${v}`));

    return sql<T>`SELECT * FROM ${rawName}(${joined})`;

}

// ─────────────────────────────────────────────────────────────
// Dialect-Specific Proc Builders
// ─────────────────────────────────────────────────────────────

/**
 * MSSQL stored procedure call.
 *
 * Named: EXEC name @key = val, @key2 = val2
 * Positional: EXEC name val, val2
 */
function buildMssqlProc<T>(rawName: RawBuilder<unknown>, params: Record<string, unknown> | unknown[]): RawBuilder<T> {

    if (Array.isArray(params)) {

        const joined = sql.join(params.map((v) => sql`${v}`));

        return sql<T>`EXEC ${rawName} ${joined}`;

    }

    const parts = Object.entries(params).map(([key, val]) =>
        sql`${sql.raw(`@${key}`)} = ${val}`,
    );

    return sql<T>`EXEC ${rawName} ${sql.join(parts)}`;

}

/**
 * PostgreSQL stored procedure call.
 *
 * Named: CALL name(key => val, key2 => val2)
 * Positional: CALL name(val, val2)
 */
function buildPostgresProc<T>(rawName: RawBuilder<unknown>, params: Record<string, unknown> | unknown[]): RawBuilder<T> {

    if (Array.isArray(params)) {

        const joined = sql.join(params.map((v) => sql`${v}`));

        return sql<T>`CALL ${rawName}(${joined})`;

    }

    const parts = Object.entries(params).map(([key, val]) =>
        sql`${sql.raw(key)} => ${val}`,
    );

    return sql<T>`CALL ${rawName}(${sql.join(parts)})`;

}

/**
 * MySQL stored procedure call.
 *
 * Always positional: CALL name(val, val2)
 * Named params fall back to positional (MySQL has no named param syntax).
 */
function buildMysqlProc<T>(rawName: RawBuilder<unknown>, params: Record<string, unknown> | unknown[]): RawBuilder<T> {

    const values = Array.isArray(params) ? params : Object.values(params);
    const joined = sql.join(values.map((v) => sql`${v}`));

    return sql<T>`CALL ${rawName}(${joined})`;

}
