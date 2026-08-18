/**
 * SQL Terminal Executor.
 *
 * Executes raw SQL queries via Kysely and returns structured results.
 */
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';
import type { Kysely, QueryResult } from 'kysely';

import { observer } from '../observer.js';
import { assertPolicy, classifyStatements } from '../policy/index.js';
import { OperationAbortedError, raceAbort } from '../shared/abort.js';
import type { Channel, ConfigAccess, Permission, SqlClass } from '../policy/index.js';
import type { Dialect } from '../connection/types.js';
import type { SqlExecutionResult } from './types.js';

/** Maps a classified statement to the permission it's gated by. */
const CLASS_PERMISSION: Record<SqlClass, Permission> = {
    read: 'sql:read',
    write: 'sql:write',
    ddl: 'sql:ddl',
};

/**
 * How a dialect is told to stop a query that is already running.
 *
 * `sessionId` reads back the server's own identifier for the connection the
 * query will run on; `cancel` is the statement that stops it, issued from a
 * *different* connection because the first one is busy.
 */
interface ServerCancel {
    sessionId: string;
    cancel: (db: Kysely<unknown>, sessionId: number) => Promise<unknown>;
}

/**
 * Dialects where aborting sends the server a cancel rather than only stopping
 * the client from listening.
 *
 * Absent by design:
 * - **mssql**: tedious exposes `request.cancel()`, but Kysely's `MssqlDialect`
 *   owns the `Request` object and never hands it out, so there is nothing to
 *   call it on from here.
 * - **sqlite**: in-process and single-connection; there is no second
 *   connection from which to interrupt the first.
 */
const SERVER_CANCEL: Partial<Record<Dialect, ServerCancel>> = {
    postgres: {
        sessionId: 'select pg_backend_pid() as id',
        cancel: (db, sessionId) => sql`select pg_cancel_backend(${sessionId})`.execute(db),
    },
    mysql: {
        // KILL cannot be prepared, so the id is interpolated. It comes from
        // connection_id() and is checked to be a positive integer before it
        // gets here, never from user input.
        sessionId: 'select connection_id() as id',
        cancel: (db, sessionId) => sql.raw(`kill query ${sessionId}`).execute(db),
    },
};

/**
 * Whether aborting a query on this dialect actually stops work on the server.
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

/** Message for an abort that reached the server. */
const SERVER_CANCEL_MESSAGE = 'Cancelled. The server was asked to stop the query.';

/** Message for an abort that only stopped the client waiting. */
const STOPPED_WAITING_MESSAGE = 'Stopped waiting. The query may still be running on the server.';

/**
 * The honest one-line outcome of aborting a query on `dialect`.
 *
 * Lives next to the strategy table so the UI cannot drift into claiming a
 * cancellation the dialect never had. A screen that reports an abort before
 * the executor returns uses this rather than wording its own.
 *
 * @example
 * setResult({ success: false, errorMessage: abortMessageFor('mssql'), durationMs: 0 });
 */
export function abortMessageFor(dialect: Dialect): string {

    return hasServerSideCancel(dialect) ? SERVER_CANCEL_MESSAGE : STOPPED_WAITING_MESSAGE;

}

/**
 * Options for a raw SQL execution.
 */
export interface ExecuteSqlOptions {
    /** Abort to stop waiting for the query. */
    signal?: AbortSignal;

    /**
     * Dialect of `db`. Only used to decide whether a cancel can be sent to the
     * server; without it an abort degrades to stopping the client.
     */
    dialect?: Dialect;
}

/**
 * Whether a cancel was armed for the query, and so whether an abort reached the
 * server or only stopped this process waiting.
 *
 * Mutable because the answer is only known part-way through the execution, and
 * the caller needs it after the abort has already handed control back.
 */
interface CancelArming {
    armed: boolean;
}

/**
 * Read the server's session identifier out of a `sessionId` probe result.
 *
 * Returns undefined for anything that is not a positive integer, which is what
 * keeps the mysql `KILL` interpolation safe: the id is interpolated into a
 * statement that cannot be prepared, so this is the only thing standing between
 * a driver returning something unexpected and that string.
 *
 * Exported for its own tests. It is a validator, and the value it rejects never
 * occurs on a healthy connection, so nothing else can exercise it.
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

/**
 * Run `query` on one pinned connection, asking the server to kill it on abort.
 *
 * Pinning is what makes the cancel land on the right session: read the id from
 * the pool and the query is free to run on a different connection, so the kill
 * would hit an idle one. The cancel itself goes through `db` — the pool — for
 * the same reason the pinned connection cannot send it: it is busy with the
 * query being cancelled.
 */
async function runWithServerCancel(
    db: Kysely<unknown>,
    query: string,
    strategy: ServerCancel,
    signal: AbortSignal,
    arming: CancelArming,
): Promise<QueryResult<unknown>> {

    return db.connection().execute(async (pinned) => {

        const probe = await sql.raw<{ id?: unknown }>(strategy.sessionId).execute(pinned);
        const sessionId = readSessionId(probe.rows);

        if (sessionId === undefined) {

            return sql.raw(query).execute(pinned);

        }

        const onAbort = () => {

            // Fire and forget: the caller has already been handed back control
            // by raceAbort, and a cancel that cannot be delivered leaves the
            // outcome exactly where it would have been without one.
            void attempt(() => strategy.cancel(db, sessionId));

        };

        // Set before the listener rather than inside it: `once` guarantees the
        // listener runs on abort, and reading a flag set by one abort listener
        // from another one's continuation would depend on dispatch order.
        arming.armed = true;

        signal.addEventListener('abort', onAbort, { once: true });

        // finally, not attempt(): the listener has to come off whether the
        // query finished, failed, or was killed out from under us.
        try {

            return await sql.raw(query).execute(pinned);

        }
        finally {

            signal.removeEventListener('abort', onAbort);

        }

    });

}

/**
 * Execute `query`, honouring `options.signal`.
 *
 * Everything about *how* an abort is handled lives here; the caller above only
 * has to know that an `OperationAbortedError` came back.
 */
function runQuery(
    db: Kysely<unknown>,
    query: string,
    options: ExecuteSqlOptions,
    arming: CancelArming,
): Promise<QueryResult<unknown>> {

    const { signal, dialect } = options;

    if (!signal) return sql.raw(query).execute(db);

    const strategy = dialect ? SERVER_CANCEL[dialect] : undefined;

    if (!strategy) {

        return raceAbort(sql.raw(query).execute(db), signal);

    }

    return raceAbort(runWithServerCancel(db, query, strategy, signal, arming), signal);

}

/**
 * Policy inputs for the ad-hoc SQL gate. Every production ad-hoc SQL surface
 * (RPC `sql` command, CLI `sql`, TUI SQL terminal) passes this: it is the
 * single seam where read/write/ddl classification is checked against the
 * config's access role for the calling channel.
 */
export interface SqlPolicyGate {
    access: ConfigAccess;
    channel: Channel;
    dialect: Dialect;
}

/**
 * Execute raw SQL and return structured results, with no policy gate.
 *
 * Uses Kysely's `sql.raw()` to execute arbitrary SQL.
 * Emits observer events before and after execution.
 *
 * Execution mechanics only — access control lives in `executeRawSql`.
 * Reserved for tests that exercise the Kysely plumbing (row shaping, error
 * handling, timing) rather than access control, and for `executeRawSql`
 * itself once it has gated. Not for production call sites: every ad-hoc
 * SQL surface (RPC, CLI, TUI) must go through `executeRawSql`.
 *
 * @param db - Kysely database instance
 * @param query - Raw SQL query to execute
 * @param configName - Config name for event context
 * @param options - Cancellation inputs; omit them and nothing changes
 * @returns Execution result with columns, rows, and metadata
 */
export async function executeRawSqlUnchecked(
    db: Kysely<unknown>,
    query: string,
    configName: string,
    options: ExecuteSqlOptions = {},
): Promise<SqlExecutionResult> {

    const start = performance.now();

    observer.emit('sql-terminal:execute:before', { query, configName });

    const arming: CancelArming = { armed: false };

    const [result, err] = await attempt(() => runQuery(db, query, options, arming));

    const durationMs = performance.now() - start;

    if (err) {

        const wasAborted = err instanceof OperationAbortedError;

        // `arming`, not the dialect's capability: a session-id probe that came
        // back with nothing leaves a postgres query with no cancel behind it,
        // and reporting one anyway is the overclaim this whole distinction
        // exists to avoid.
        const serverWasAsked = wasAborted && arming.armed;

        const errorMessage = wasAborted
            ? (serverWasAsked ? SERVER_CANCEL_MESSAGE : STOPPED_WAITING_MESSAGE)
            : (err instanceof Error ? err.message : String(err));

        observer.emit('sql-terminal:execute:after', {
            query,
            configName,
            success: false,
            durationMs,
            error: errorMessage,
        });

        if (wasAborted) {

            return {
                success: false,
                errorMessage,
                durationMs,
                aborted: serverWasAsked ? 'server-cancel-requested' : 'stopped-waiting',
            };

        }

        return {
            success: false,
            errorMessage,
            durationMs,
        };

    }

    // Parse Kysely result structure
    const rows = (result!.rows ?? []) as Record<string, unknown>[];
    const firstRow = rows[0];
    const columns = firstRow ? Object.keys(firstRow) : [];

    // Get affected rows for DML statements
    // Note: numAffectedRows can be 0n (bigint 0), which is falsy but valid
    const rowsAffected = result!.numAffectedRows !== undefined
        ? Number(result!.numAffectedRows)
        : undefined;

    observer.emit('sql-terminal:execute:after', {
        query,
        configName,
        success: true,
        durationMs,
        rowCount: rows.length,
        rowsAffected,
    });

    return {
        success: true,
        columns,
        rows,
        rowsAffected,
        durationMs,
    };

}

/**
 * Execute raw SQL and return structured results.
 *
 * Classifies `query` (read/write/ddl) and checks it against `gate.access`
 * for `gate.channel` before executing — `gate` is mandatory so the
 * production-facing symbol can never run raw SQL ungated. Delegates to
 * `executeRawSqlUnchecked` once the check passes.
 *
 * @param db - Kysely database instance
 * @param query - Raw SQL query to execute
 * @param configName - Config name for event context
 * @param gate - Policy inputs the query is classified and checked against
 * @param signal - Abort to stop waiting. Whether that also stops the server
 *                 depends on the dialect; the result says which happened.
 * @returns Execution result with columns, rows, and metadata
 *
 * @throws Error carrying the policy's blockedReason when `gate` denies.
 *
 * @example
 * ```typescript
 * const result = await executeRawSql(db, 'SELECT * FROM users LIMIT 10', 'production', {
 *     access: config.access,
 *     channel: 'user',
 *     dialect: 'postgres',
 * })
 *
 * if (result.success) {
 *     console.log(result.columns)  // ['id', 'name', 'email']
 *     console.log(result.rows)     // [{id: 1, name: 'Alice', ...}, ...]
 * }
 * else {
 *     console.error(result.errorMessage)
 * }
 * ```
 */
export async function executeRawSql(
    db: Kysely<unknown>,
    query: string,
    configName: string,
    gate: SqlPolicyGate,
    signal?: AbortSignal,
): Promise<SqlExecutionResult> {

    const statementClass = classifyStatements(query, gate.dialect);

    assertPolicy(gate.channel, { name: configName, access: gate.access }, CLASS_PERMISSION[statementClass]);

    return executeRawSqlUnchecked(db, query, configName, { signal, dialect: gate.dialect });

}
