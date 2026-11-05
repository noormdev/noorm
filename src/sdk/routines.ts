/**
 * proc/func/tvf over any executor, shared by Context, the transaction
 * handle, and the impersonated scope.
 */
import { attempt } from '@logosdx/utils';
import { sql } from 'kysely';

import type { Kysely, Transaction } from 'kysely';
import type { Dialect } from '../core/connection/types.js';

import { buildProcCall, buildFuncCall, buildTvfCall } from './sql.js';
import type { RoutineCalls, TransactionScope } from './types.js';

type RoutineParams = Record<string, unknown> | unknown[] | undefined;

// Resolved after the SQL is built, so an unsupported dialect (sqlite procs,
// mysql TVFs) reports that rather than a missing connection.
type DbProvider<DB> = () => Kysely<DB>;

/**
 * The sql.ts builders split on `.` and quote each segment.
 *
 * @example
 * qualifyName('acct', 'rebuild_ledger'); // 'acct.rebuild_ledger'
 * qualifyName('acct', 'other.rebuild_ledger'); // unchanged
 */
export function qualifyName(schema: string | null, name: string): string {

    if (!schema || name.includes('.')) return name;

    return `${schema}.${name}`;

}

/**
 * Call a stored procedure and return its rows.
 *
 * On postgres, `CALL` against a FUNCTION fails, and the noorm playbook has
 * row-returning ops written as functions, so that failure retries as
 * `SELECT * FROM name(...)`. Inside a transaction the failed `CALL` would
 * abort the transaction, so there `pg_proc` decides between the two up front.
 *
 * @example
 * const rows = await callProc<User>(() => db, 'postgres', 'get_users', [{ id: 1 }]);
 */
export async function callProc<T, DB = unknown>(
    getDb: DbProvider<DB>,
    dialect: Dialect,
    name: string,
    args: unknown[],
): Promise<T[]> {

    const params = routineParams(args);
    const callQuery = buildProcCall<T>(dialect, name, params);
    const db = getDb();

    if (dialect !== 'postgres') {

        const result = await callQuery.execute(db);

        return result.rows ?? [];

    }

    if (db.isTransaction) {

        if (!await isProcedure(db, name)) return callTvf<T, DB>(() => db, 'postgres', name, args);

        const result = await callQuery.execute(db);

        return result.rows ?? [];

    }

    const [callResult, callErr] = await attempt(() => callQuery.execute(db));

    if (!callErr) return callResult.rows ?? [];

    if (!isFunctionNotProcedureError(callErr)) throw callErr;

    return callTvf<T, DB>(() => db, 'postgres', name, args);

}

/**
 * Call a scalar database function and return its first row, or null.
 * `args` is `[column]` or `[params, column]`, as `Context.func` takes them.
 *
 * @example
 * const row = await callFunc<{ total: number }>(() => db, 'postgres', 'calc_total', [{ order_id: 1 }, 'total']);
 */
export async function callFunc<T, DB = unknown>(
    getDb: DbProvider<DB>,
    dialect: Dialect,
    name: string,
    args: unknown[],
): Promise<T> {

    const hasParams = !(args.length === 1 && typeof args[0] === 'string');
    const params = hasParams ? routineParams(args) : undefined;
    const column = String(hasParams ? args[1] : args[0]);

    const result = await buildFuncCall<T>(dialect, name, column, params).execute(getDb());

    return (result.rows?.[0] ?? null) as T;

}

/**
 * Call a table-valued function and return its rows. Dialect rules and the
 * mysql/sqlite rejection live in buildTvfCall.
 *
 * @example
 * const rows = await callTvf<Session>(() => db, 'mssql', 'fn_sessions', [['key']]);
 */
export async function callTvf<T, DB = unknown>(
    getDb: DbProvider<DB>,
    dialect: Dialect,
    name: string,
    args: unknown[],
): Promise<T[]> {

    const result = await buildTvfCall<T>(dialect, name, routineParams(args)).execute(getDb());

    return result.rows ?? [];

}

/**
 * Bind proc/func/tvf to a connection, qualifying names with `schema`.
 *
 * @example
 * const { proc } = routineCalls(() => db, 'postgres', null);
 */
export function routineCalls<DB, Procs, Funcs, Tvfs>(
    getDb: DbProvider<DB>,
    dialect: Dialect,
    schema: string | null,
): RoutineCalls<Procs, Funcs, Tvfs> {

    return {

        proc: <T>(name: string, ...args: unknown[]) => callProc<T, DB>(getDb, dialect, qualifyName(schema, name), args),

        func: <T>(name: string, ...args: unknown[]) => callFunc<T, DB>(getDb, dialect, qualifyName(schema, name), args),

        tvf: <T>(name: string, ...args: unknown[]) => callTvf<T, DB>(getDb, dialect, qualifyName(schema, name), args),

    };

}

/**
 * Attach proc/func/tvf to Kysely's transaction instance, so the handle
 * stays a real `Transaction<DB>` for every builder method and callers
 * annotated with Kysely's type keep compiling.
 *
 * @example
 * return db.transaction().execute((trx) => fn(withRoutines(trx, dialect, schema)));
 */
export function withRoutines<DB, Procs, Funcs, Tvfs>(
    trx: Transaction<DB>,
    dialect: Dialect,
    schema: string | null,
): TransactionScope<DB, Procs, Funcs, Tvfs> {

    return Object.assign(trx, routineCalls<DB, Procs, Funcs, Tvfs>(() => trx, dialect, schema));

}

function routineParams(args: unknown[]): RoutineParams {

    // cast-justified: the typed overloads on Context/RoutineCalls constrain args[0]
    return args[0] as RoutineParams;

}

// Same split as quoteIdent in sql.ts, so the lookup checks the object CALL would name.
async function isProcedure<DB>(db: Kysely<DB>, name: string): Promise<boolean> {

    const [schema, proname] = name.includes('.') ? name.split('.', 2) : [null, name];
    const inSchema = schema === null
        ? sql`n.nspname = ANY (current_schemas(false))`
        : sql`n.nspname = ${schema}`;

    const result = await sql<{ is_procedure: boolean }>`
        SELECT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE p.prokind = 'p' AND p.proname = ${proname} AND ${inSchema}
        ) AS is_procedure
    `.execute(db);

    return result.rows[0]?.is_procedure === true;

}

/**
 * Detect a PG `CALL`-against-FUNCTION error. PostgreSQL surfaces it as
 * SQLSTATE 42809 (`<name>(...) is not a procedure`) when an exact match is
 * the wrong kind of object, or 42883 (`procedure <name>(...) does not
 * exist`, hint `To call a function, use SELECT.`) when only a function
 * with that signature exists.
 */
function isFunctionNotProcedureError(err: unknown): boolean {

    if (!err || typeof err !== 'object') return false;

    // cast-justified: pg driver error has no fixed type
    const obj = err as { code?: string; message?: string; hint?: string };

    if (obj.code !== '42809' && obj.code !== '42883') return false;

    const msg = String(obj.message ?? '');
    const hint = String(obj.hint ?? '');

    return msg.includes('procedure') || hint.includes('use SELECT');

}
