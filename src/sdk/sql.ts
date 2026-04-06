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
import { isTvp, MSSQL_PARAM_LIMIT } from './tvp.js';
import type { TvpValue } from './tvp.js';

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

    // TVP check — only MSSQL supports table-valued parameters
    if (params && hasTvpParam(params) && dialect !== 'mssql') {

        throw new Error('Table-valued parameters (TVP) are only supported on MSSQL.');

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

    // TVP check — only MSSQL supports table-valued parameters
    if (params && hasTvpParam(params) && dialect !== 'mssql') {

        throw new Error('Table-valued parameters (TVP) are only supported on MSSQL.');

    }

    const rawName = sql.raw(name);
    const rawCol = sql.raw(column);

    if (!params || (Array.isArray(params) && params.length === 0) || (!Array.isArray(params) && Object.keys(params).length === 0)) {

        return sql<T>`SELECT ${rawName}() AS ${rawCol}`;

    }

    // MSSQL with TVP — always use EXEC pattern (SELECT syntax can't pass TVPs)
    if (dialect === 'mssql' && hasTvpParam(params)) {

        return buildMssqlFuncWithTvp<T>(rawName, rawCol, params);

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

    // TVP check — only MSSQL supports table-valued parameters
    if (params && hasTvpParam(params) && dialect !== 'mssql') {

        throw new Error('Table-valued parameters (TVP) are only supported on MSSQL.');

    }

    const rawName = sql.raw(name);

    if (!params || (Array.isArray(params) && params.length === 0) || (!Array.isArray(params) && Object.keys(params).length === 0)) {

        return sql<T>`SELECT * FROM ${rawName}()`;

    }

    // MSSQL with TVP — preamble + SELECT * FROM tvf(...)
    if (dialect === 'mssql' && hasTvpParam(params)) {

        return buildMssqlTvfWithTvp<T>(rawName, params);

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
 *
 * When TVP parameters are detected, generates a DECLARE/INSERT/EXEC
 * batch that populates table variables before the procedure call.
 */
function buildMssqlProc<T>(rawName: RawBuilder<unknown>, params: Record<string, unknown> | unknown[]): RawBuilder<T> {

    if (hasTvpParam(params)) {

        return buildMssqlProcWithTvp<T>(rawName, params);

    }

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

// ──────────────────────���──────────────────────��───────────────
// TVP Helpers
// ────���───────────────────────────────────────────────────��────

/**
 * Check if any parameter value is a TVP marker.
 */
function hasTvpParam(params: Record<string, unknown> | unknown[]): boolean {

    const values = Array.isArray(params) ? params : Object.values(params);

    return values.some(isTvp);

}

/**
 * Count total bound parameters including expanded TVP rows.
 *
 * Each TVP contributes rows * columns parameters. Throws if the
 * total exceeds MSSQL's 2,100 parameter limit per batch.
 */
function validateTvpParamCount(params: Record<string, unknown> | unknown[]): void {

    const values = Array.isArray(params) ? params : Object.values(params);
    let count = 0;

    for (const val of values) {

        if (isTvp(val)) {

            if (val.rows.length > 0) {

                count += val.rows.length * Object.keys(val.rows[0]!).length;

            }

        }
        else {

            count += 1;

        }

    }

    if (count > MSSQL_PARAM_LIMIT) {

        throw new Error(
            'TVP parameter count (' + count + ') exceeds MSSQL limit of ' + MSSQL_PARAM_LIMIT + '. ' +
            'Split your TVP rows into smaller batches and call the procedure multiple times.',
        );

    }

}

/**
 * MSSQL stored procedure call with TVP parameters.
 *
 * Generates a DECLARE/INSERT/EXEC batch:
 * 1. DECLARE table variables for each TVP parameter
 * 2. INSERT rows into the table variables (all values parameterized)
 * 3. EXEC the procedure, referencing table variables for TVP params
 *
 * This bypasses Kysely's parameter binding for TVPs (which lacks
 * TYPES.TVP detection) while keeping all user data parameterized.
 *
 * @example
 * ```sql
 * -- Named params
 * DECLARE @__tvp_Items CheckoutItems;
 * INSERT INTO @__tvp_Items ([Type], [ReferenceNo], [Qty]) VALUES (@1, @2, @3), (@4, @5, @6);
 * EXEC Checkout_trx @Party = @7, @PaymentMethod = @8, @Items = @__tvp_Items
 *
 * -- Positional params
 * DECLARE @__tvp_2 CheckoutItems;
 * INSERT INTO @__tvp_2 ([Type], [ReferenceNo], [Qty]) VALUES (@1, @2, @3), (@4, @5, @6);
 * EXEC Checkout_trx @7, @8, @__tvp_2
 * ```
 */
function buildMssqlProcWithTvp<T>(
    rawName: RawBuilder<unknown>,
    params: Record<string, unknown> | unknown[],
): RawBuilder<T> {

    // === Declaration block ===
    validateTvpParamCount(params);
    const preamble: RawBuilder<unknown>[] = [];
    const execParts: RawBuilder<unknown>[] = [];

    // === Business logic block ===
    if (Array.isArray(params)) {

        for (let i = 0; i < params.length; i++) {

            const val = params[i];

            if (isTvp(val)) {

                const varName = `@__tvp_${i}`;
                appendTvpStatements(preamble, varName, val);
                execParts.push(sql.raw(varName));

            }
            else {

                execParts.push(sql`${val}`);

            }

        }

    }
    else {

        for (const [key, val] of Object.entries(params)) {

            if (isTvp(val)) {

                const varName = `@__tvp_${key}`;
                appendTvpStatements(preamble, varName, val);
                execParts.push(sql`${sql.raw(`@${key}`)} = ${sql.raw(varName)}`);

            }
            else {

                execParts.push(sql`${sql.raw(`@${key}`)} = ${val}`);

            }

        }

    }

    const execStmt = sql`EXEC ${rawName} ${sql.join(execParts)}`;

    // === Commit block ===
    if (preamble.length === 0) {

        return execStmt as RawBuilder<T>;

    }

    return sql.join([...preamble, execStmt], sql.raw('; ')) as RawBuilder<T>;

}

/**
 * Append DECLARE and INSERT statements for a TVP parameter.
 *
 * Generates parameterized INSERT with all row values bound
 * as Kysely parameters to prevent SQL injection.
 */
function appendTvpStatements(
    statements: RawBuilder<unknown>[],
    varName: string,
    tvpVal: TvpValue,
): void {

    // DECLARE @varName TypeName
    statements.push(sql.raw(`DECLARE ${varName} ${tvpVal.typeName}`));

    // INSERT rows (skip if empty — passes empty table to proc)
    if (tvpVal.rows.length === 0) return;

    const cols = Object.keys(tvpVal.rows[0]!);
    const colList = cols.map((c) => `[${c}]`).join(', ');

    const rowFragments = tvpVal.rows.map((row) => {

        const values = cols.map((c) => sql`${row[c]}`);

        return sql`(${sql.join(values)})`;

    });

    statements.push(
        sql`INSERT INTO ${sql.raw(varName)} (${sql.raw(colList)}) VALUES ${sql.join(rowFragments)}`,
    );

}

/**
 * MSSQL scalar function call with TVP parameters.
 *
 * Uses the EXEC @result = func pattern for both named and positional
 * params, since SELECT func(@tvp_var) syntax is not supported for TVPs.
 *
 * @example
 * ```sql
 * DECLARE @__tvp_Items ItemType;
 * INSERT INTO @__tvp_Items ([col]) VALUES (@1);
 * DECLARE @__result sql_variant;
 * EXEC @__result = my_func @scalar = @2, @Items = @__tvp_Items;
 * SELECT @__result AS col_alias
 * ```
 */
function buildMssqlFuncWithTvp<T>(
    rawName: RawBuilder<unknown>,
    rawCol: RawBuilder<unknown>,
    params: Record<string, unknown> | unknown[],
): RawBuilder<T> {

    // === Declaration block ===
    validateTvpParamCount(params);
    const preamble: RawBuilder<unknown>[] = [];
    const execParts: RawBuilder<unknown>[] = [];

    // === Business logic block ===
    if (Array.isArray(params)) {

        for (let i = 0; i < params.length; i++) {

            const val = params[i];

            if (isTvp(val)) {

                const varName = `@__tvp_${i}`;
                appendTvpStatements(preamble, varName, val);
                execParts.push(sql.raw(varName));

            }
            else {

                execParts.push(sql`${val}`);

            }

        }

    }
    else {

        for (const [key, val] of Object.entries(params)) {

            if (isTvp(val)) {

                const varName = `@__tvp_${key}`;
                appendTvpStatements(preamble, varName, val);
                execParts.push(sql`${sql.raw(`@${key}`)} = ${sql.raw(varName)}`);

            }
            else {

                execParts.push(sql`${sql.raw(`@${key}`)} = ${val}`);

            }

        }

    }

    // === Commit block ===
    const funcStmt = sql`DECLARE @__result sql_variant; EXEC @__result = ${rawName} ${sql.join(execParts)}; SELECT @__result AS ${rawCol}`;

    if (preamble.length === 0) {

        return funcStmt as RawBuilder<T>;

    }

    return sql.join([...preamble, funcStmt], sql.raw('; ')) as RawBuilder<T>;

}

/**
 * MSSQL table-valued function call with TVP parameters.
 *
 * Generates DECLARE/INSERT preamble + SELECT * FROM tvf(...) with
 * table variable references for TVP params.
 *
 * @example
 * ```sql
 * DECLARE @__tvp_1 ItemType;
 * INSERT INTO @__tvp_1 ([col]) VALUES (@1);
 * SELECT * FROM my_tvf(@2, @__tvp_1)
 * ```
 */
function buildMssqlTvfWithTvp<T>(
    rawName: RawBuilder<unknown>,
    params: Record<string, unknown> | unknown[],
): RawBuilder<T> {

    // === Declaration block ===
    validateTvpParamCount(params);
    const preamble: RawBuilder<unknown>[] = [];
    const callParts: RawBuilder<unknown>[] = [];

    // === Business logic block ===
    // TVF FROM clause uses positional syntax on MSSQL,
    // so both named and positional params flatten to positional
    if (Array.isArray(params)) {

        for (let i = 0; i < params.length; i++) {

            const val = params[i];

            if (isTvp(val)) {

                const varName = `@__tvp_${i}`;
                appendTvpStatements(preamble, varName, val);
                callParts.push(sql.raw(varName));

            }
            else {

                callParts.push(sql`${val}`);

            }

        }

    }
    else {

        for (const [key, val] of Object.entries(params)) {

            if (isTvp(val)) {

                const varName = `@__tvp_${key}`;
                appendTvpStatements(preamble, varName, val);
                callParts.push(sql.raw(varName));

            }
            else {

                callParts.push(sql`${val}`);

            }

        }

    }

    // === Commit block ===
    const selectStmt = sql`SELECT * FROM ${rawName}(${sql.join(callParts)})`;

    if (preamble.length === 0) {

        return selectStmt as RawBuilder<T>;

    }

    return sql.join([...preamble, selectStmt], sql.raw('; ')) as RawBuilder<T>;

}
