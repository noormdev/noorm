/**
 * The row-peek read: `SELECT * FROM <table> ORDER BY <key>`, one page of it.
 *
 * Built with Kysely's query builder rather than a `sql` template, which is a
 * deliberate departure from the rest of this module. Everything else here
 * queries a catalog whose shape differs per vendor, so each dialect writes its
 * own statement. This reads a user table, where the statement is the same
 * everywhere and only the row cap differs — so it is one builder with one
 * branch rather than four near-identical methods.
 *
 * Two things the builder buys, and one it does not:
 *
 * - **Identifier quoting, per dialect, for free.** Postgres, SQLite and MSSQL
 *   wrap in `"` and escape an embedded one by doubling it; MySQL uses backticks
 *   the same way. The compiler on the connection does that, so nothing here
 *   concatenates a name into SQL. Schema and table names come from the
 *   database's own catalog, but a table named `we"ird` is still the difference
 *   between an identifier and an aborted statement.
 * - **A bound parameter for the page size**, on the three dialects that take
 *   one. `.top()` inlines its argument instead, which is why the value is
 *   clamped to an integer before it gets there.
 * - **No portability for the row cap at all.** Kysely emits whichever method
 *   was called, verbatim, on every dialect, and neither method throws when used
 *   on the wrong one: `.limit()` compiles to `limit @1` on SQL Server and
 *   `.top()` compiles to `top(10)` on the other three. Each is valid on a
 *   disjoint set, so the branch below is mandatory and the failure it prevents
 *   is invisible until a server sees the statement. `tests/core/explore/
 *   peek.test.ts` pins the exact string per dialect for exactly that reason.
 *
 * On the last point, `MssqlLimitPlugin` (`core/connection/dialects/
 * mssql-limit-plugin.ts`) already rewrites `LimitNode` to `TopNode` on every
 * connection noorm builds, so `.limit()` alone would in fact work there today.
 * The branch is kept anyway, and the two do not fight: the plugin declines a
 * query that already carries a `top`. It is kept because this function takes
 * any `Kysely` instance — an SDK caller's own, or a test harness's — and only
 * connections that came through `createConnection` carry the plugin. Emitting
 * the clause the dialect accepts is correct with the plugin and without it;
 * relying on the plugin is correct only with it.
 *
 * Names are passed as `sql.id()` expressions rather than the plain strings
 * `selectFrom` also accepts, because Kysely parses a string table reference and
 * splits it on `.`: `selectFrom('we.ird')` compiles to `"we"."ird"`, silently
 * reading a different table. `sql.id('we.ird')` stays one identifier.
 *
 * @example
 * ```typescript
 * const rows = await readPeekRows(db, 'mssql', {
 *     table: 'users',
 *     schema: 'dbo',
 *     keyColumns: ['id'],
 *     direction: 'desc',
 *     limit: 10,
 * });
 * // select top(10) * from "dbo"."users" as "peek" order by "id" desc
 * ```
 */
import { sql } from 'kysely';

import type { Kysely, SelectQueryBuilder } from 'kysely';
import type { Dialect } from '../connection/types.js';
import type { RowPeekQuery } from './types.js';

/**
 * Most rows a single peek will read, however many the caller asks for.
 *
 * A peek is a look at both ends of a table, not an export. The ceiling exists
 * so a caller that sizes its page from something unbounded cannot turn one
 * keystroke into a full-table read.
 */
export const MAX_PEEK_ROWS = 500;

/**
 * Which row-cap clause each dialect accepts.
 *
 * A `Record<Dialect, …>` rather than a conditional, so a fifth dialect added to
 * the `Dialect` union fails to compile here instead of falling through to
 * whichever branch happened to be the default — and the wrong branch is not a
 * type error or a thrown exception anywhere else, only a rejected statement at
 * runtime.
 */
const LIMIT_STYLE: Record<Dialect, 'limit' | 'top'> = {
    postgres: 'limit',
    mysql: 'limit',
    sqlite: 'limit',
    mssql: 'top',
};

/**
 * Alias every peek carries, so the `FROM` clause is a table expression rather
 * than a bare identifier reference.
 */
const PEEK_ALIAS = 'peek';

/**
 * Cap a result set the way this dialect can express it.
 *
 * The entire portability question, in one function, so a future simplification
 * to a bare `.limit()` has a test to fail rather than a runtime error to
 * produce. `.top()` is the mssql form rather than `OFFSET/FETCH` because it
 * compiles correctly with *and* without an `ORDER BY`, which is what lets the
 * primary-key path and the no-key path share one shape — T-SQL requires an
 * `ORDER BY` before `OFFSET/FETCH`, and Kysely will emit it without one and
 * leave SQL Server to object.
 *
 * @example
 * applyRowLimit(query, 'mssql', 10);     // select top(10) * from ...
 * applyRowLimit(query, 'postgres', 10);  // select * from ... limit $1
 */
export function applyRowLimit<DB, TB extends keyof DB, O>(
    query: SelectQueryBuilder<DB, TB, O>,
    dialect: Dialect,
    limit: number,
): SelectQueryBuilder<DB, TB, O> {

    return LIMIT_STYLE[dialect] === 'top' ? query.top(limit) : query.limit(limit);

}

/**
 * Bound the page size and force it to a whole number.
 *
 * `.top()` inlines its argument into the SQL rather than binding it, so the
 * value has to be provably an integer before it gets there.
 */
function clampLimit(limit: number): number {

    if (!Number.isFinite(limit)) return 1;

    return Math.max(1, Math.min(MAX_PEEK_ROWS, Math.trunc(limit)));

}

/**
 * The select the peek runs, unexecuted.
 *
 * Separate from the execution so a test can assert the compiled SQL for every
 * dialect without a database, which is the only cheap guard against the
 * `limit`/`top` split.
 *
 * @example
 * peekQuery(db, 'mssql', request).compile().sql;
 * // 'select top(10) * from "dbo"."users" as "peek" order by "id" asc'
 */
export function peekQuery(
    db: Kysely<unknown>,
    dialect: Dialect,
    query: RowPeekQuery,
) {

    const target = query.schema
        ? sql.id(query.schema, query.table)
        : sql.id(query.table);

    let selected = db.selectFrom(target.as(PEEK_ALIAS)).selectAll();

    // No key means no order to ask for. Inventing one over an arbitrary column
    // would cost a full scan and a sort, on a table of unbounded size, to
    // answer a question the reader asked in passing.
    for (const column of query.keyColumns) {

        selected = selected.orderBy(sql.id(column), query.direction);

    }

    return applyRowLimit(selected, dialect, clampLimit(query.limit));

}

/**
 * Read one page of a table's rows.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect, which decides how the page is capped
 * @param query - Table, key columns, direction and page size
 * @returns The rows, in the order the database returned them
 *
 * @example
 * ```typescript
 * const head = await readPeekRows(db, 'postgres', {
 *     table: 'users',
 *     schema: 'public',
 *     keyColumns: ['id'],
 *     direction: 'asc',
 *     limit: 10,
 * });
 * ```
 */
export async function readPeekRows(
    db: Kysely<unknown>,
    dialect: Dialect,
    query: RowPeekQuery,
): Promise<Record<string, unknown>[]> {

    return peekQuery(db, dialect, query).execute();

}
