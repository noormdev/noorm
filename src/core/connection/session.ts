/**
 * Server-side session identity and cancellation.
 *
 * Shared by every caller that needs to point at one running statement from
 * outside it: the SQL terminal cancelling a query, and the runner's statement
 * watcher polling and cancelling a file. Both pin a connection, read its
 * session id here, then act on that id from a second connection.
 */
import { sql } from 'kysely';
import type { QueryExecutorProvider } from 'kysely';

import type { Dialect } from './types.js';

/**
 * Query that reads back the server's own identifier for the connection it
 * runs on, as a single `id` column.
 *
 * sqlite is absent: in-process and single-connection, it has no session a
 * second connection could observe.
 */
export const SESSION_ID_SQL: Partial<Record<Dialect, string>> = {
    postgres: 'select pg_backend_pid() as id',
    mysql: 'select connection_id() as id',
    mssql: 'select @@SPID as id',
};

/**
 * How a dialect is told to stop a statement that is already running, issued
 * from a *different* connection because the first one is busy.
 */
export type ServerCancel = (db: QueryExecutorProvider, sessionId: number) => Promise<unknown>;

/**
 * Dialects where aborting sends the server a cancel rather than only stopping
 * the client from listening.
 *
 * mssql is absent: tedious exposes `request.cancel()`, but Kysely's `MssqlDialect`
 * owns the `Request` object and never hands it out, and `KILL` would end the
 * whole session, not the request. sqlite: see `SESSION_ID_SQL`.
 */
export const SERVER_CANCEL: Partial<Record<Dialect, ServerCancel>> = {
    postgres: (db, sessionId) => sql`select pg_cancel_backend(${sessionId})`.execute(db),
    // KILL cannot be prepared, so the id is interpolated. It comes from
    // connection_id() and is checked by readSessionId before it gets here,
    // never from user input.
    mysql: (db, sessionId) => sql.raw(`kill query ${sessionId}`).execute(db),
};

/**
 * Whether aborting a statement on this dialect actually stops work on the server.
 *
 * Callers use it to word the outcome: "cancelled" is only true where this
 * returns true, and "stopped waiting" is the honest phrasing everywhere else.
 *
 * @example
 * const message = hasServerSideCancel(dialect)
 *     ? 'Cancelled. The server was asked to stop the query.'
 *     : 'Stopped waiting. The query may still be running on the server.';
 */
export function hasServerSideCancel(dialect: Dialect): boolean {

    return SERVER_CANCEL[dialect] !== undefined;

}

/**
 * Read the server's session identifier out of a `SESSION_ID_SQL` result.
 *
 * Returns undefined for anything that is not a positive integer, which is what
 * keeps the mysql `KILL` interpolation safe: the id is interpolated into a
 * statement that cannot be prepared, so this is the only thing standing between
 * a driver returning something unexpected and that string.
 *
 * @example
 * readSessionId([{ id: '4711' }]) // => 4711
 * readSessionId([{ id: '4711; drop table users' }]) // => undefined
 */
export function readSessionId(rows: readonly { id?: unknown }[]): number | undefined {

    const raw = rows[0]?.id;
    const id = Number(raw);

    if (!Number.isInteger(id) || id <= 0) return undefined;

    return id;

}
