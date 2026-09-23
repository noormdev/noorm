/**
 * Per-dialect queries that describe one running statement from outside it.
 *
 * Every probe runs on the watcher's side connection against the session id of
 * the connection executing the file. Each part of a probe (activity, blockers,
 * progress) is attempted on its own: a missing view or a missing privilege
 * drops that part of the report, never the whole report.
 */
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';
import type { QueryExecutorProvider } from 'kysely';

import type { Dialect } from '../connection/types.js';

/**
 * A session holding a lock the watched statement is waiting on.
 */
export interface BlockingSession {
    pid: number;

    /** Start of the blocker's statement text, or its command/status when no text is visible. */
    query: string | null;

    /** How long the blocker has been in its current transaction or request. */
    ageMs: number | null;
}

/**
 * Progress an operation reports about itself, from the dialect's progress views.
 */
export interface OperationProgress {
    /** What is running, e.g. `CREATE INDEX`, `VACUUM`, `COPY FROM`. */
    operation: string;

    /** Phase within the operation, e.g. `building index: loading tuples`. */
    phase: string | null;

    relation: string | null;

    done: number | null;
    total: number | null;

    /** 0-100, when the dialect reports enough to compute it. */
    percent: number | null;
}

/**
 * What the server says about a running statement at one point in time.
 */
export interface StatementStatus {
    /** Session state, e.g. `active`, `suspended`, a mysql thread state. */
    state: string | null;

    /** What the session is waiting on, e.g. `Lock: transactionid`. Null when it is working. */
    waitEvent: string | null;

    blockedBy: BlockingSession[];

    workers: number;

    progress: OperationProgress | null;
}

type StatementProbe = (side: QueryExecutorProvider, sessionId: number) => Promise<StatementStatus>;

/**
 * Percent from a done/total pair, or null when the total is unknown.
 *
 * @example
 * percentOf(4210, 9800) // => 42.96
 * percentOf(12, 0) // => null
 */
function percentOf(done: number | null, total: number | null): number | null {

    if (done === null || total === null || total <= 0) return null;

    return Math.min(100, (done / total) * 100);

}

function toNumber(value: unknown): number | null {

    if (value === null || value === undefined) return null;

    const n = Number(value);

    return Number.isFinite(n) ? n : null;

}

function toText(value: unknown): string | null {

    if (value === null || value === undefined || value === '') return null;

    return String(value);

}

async function rowsOrEmpty<T>(query: () => Promise<{ rows: T[] }>): Promise<T[]> {

    const [result, err] = await attempt(query);

    return err ? [] : result.rows;

}

interface PgActivityRow {
    state: string | null;
    wait_event_type: string | null;
    wait_event: string | null;
    blockers: number[] | null;
    workers: number;
}

interface BlockerRow {
    pid: number;
    query: string | null;
    age_ms: number | null;
}

interface PgProgressRow {
    operation: string;
    phase: string | null;
    relation: string | null;
    done: number | null;
    total: number | null;
}

function toBlockers(rows: BlockerRow[]): BlockingSession[] {

    return rows.map((row) => ({
        pid: Number(row.pid),
        query: toText(row.query),
        ageMs: toNumber(row.age_ms),
    }));

}

/**
 * Postgres: `pg_stat_activity`, `pg_blocking_pids()`, and the
 * `pg_stat_progress_*` views. `leader_pid` needs Postgres 13+.
 *
 * For CREATE INDEX, tuples are preferred when reported; HNSW reports
 * `tuples_total = 0`, so it falls back to blocks.
 */
const postgresProbe: StatementProbe = async (side, pid) => {

    const [activity] = await rowsOrEmpty(() => sql<PgActivityRow>`
        select a.state, a.wait_event_type, a.wait_event,
               pg_blocking_pids(a.pid) as blockers,
               (select count(*)::int from pg_stat_activity w
                 where w.leader_pid = a.pid and w.pid <> a.pid) as workers
          from pg_stat_activity a
         where a.pid = ${pid}
    `.execute(side));

    const blockerPids = (activity?.blockers ?? []).map(Number);

    const blockers = blockerPids.length === 0 ? [] : await rowsOrEmpty(() => sql<BlockerRow>`
        select pid, left(query, 120) as query,
               (extract(epoch from now() - coalesce(xact_start, query_start)) * 1000)::float8 as age_ms
          from pg_stat_activity
         where pid = any(${blockerPids}::int[])
    `.execute(side));

    const [progress] = await rowsOrEmpty(() => sql<PgProgressRow>`
        select command as operation, phase,
               nullif(relid, 0)::regclass::text as relation,
               (case when tuples_total > 0 then tuples_done else blocks_done end)::float8 as done,
               (case when tuples_total > 0 then tuples_total else blocks_total end)::float8 as total
          from pg_stat_progress_create_index where pid = ${pid}
        union all
        select 'VACUUM', phase, nullif(relid, 0)::regclass::text,
               heap_blks_scanned::float8, heap_blks_total::float8
          from pg_stat_progress_vacuum where pid = ${pid}
        union all
        select command, phase, nullif(relid, 0)::regclass::text,
               heap_blks_scanned::float8, heap_blks_total::float8
          from pg_stat_progress_cluster where pid = ${pid}
        union all
        select command, null, nullif(relid, 0)::regclass::text,
               bytes_processed::float8, nullif(bytes_total, 0)::float8
          from pg_stat_progress_copy where pid = ${pid}
        union all
        select 'ANALYZE', phase, nullif(relid, 0)::regclass::text,
               sample_blks_scanned::float8, sample_blks_total::float8
          from pg_stat_progress_analyze where pid = ${pid}
        limit 1
    `.execute(side));

    const waitEvent = activity?.wait_event
        ? `${activity.wait_event_type ?? 'Wait'}: ${activity.wait_event}`
        : null;

    return {
        state: toText(activity?.state),
        waitEvent,
        blockedBy: toBlockers(blockers),
        workers: toNumber(activity?.workers) ?? 0,
        progress: progress
            ? {
                operation: progress.operation,
                phase: toText(progress.phase),
                relation: toText(progress.relation),
                done: toNumber(progress.done),
                total: toNumber(progress.total),
                percent: percentOf(toNumber(progress.done), toNumber(progress.total)),
            }
            : null,
    };

};

interface MssqlRequestRow {
    status: string | null;
    wait_type: string | null;
    blocking_session_id: number | null;
    percent_complete: number | null;
    command: string | null;
}

/**
 * MSSQL: `sys.dm_exec_requests`. Seeing another session's request needs
 * `VIEW SERVER STATE` (`VIEW SERVER PERFORMANCE STATE` on 2022); without it
 * the report is empty and only elapsed time is shown.
 */
const mssqlProbe: StatementProbe = async (side, spid) => {

    const [request] = await rowsOrEmpty(() => sql<MssqlRequestRow>`
        select status, wait_type, blocking_session_id, percent_complete, command
          from sys.dm_exec_requests
         where session_id = ${spid}
    `.execute(side));

    const blockerId = toNumber(request?.blocking_session_id);

    const blockers = !blockerId ? [] : await rowsOrEmpty(() => sql<BlockerRow>`
        select s.session_id as pid,
               coalesce(left(t.text, 120), r.command, s.status) as query,
               datediff_big(millisecond, coalesce(r.start_time, s.last_request_start_time), sysdatetime()) as age_ms
          from sys.dm_exec_sessions s
          left join sys.dm_exec_requests r on r.session_id = s.session_id
          outer apply sys.dm_exec_sql_text(r.sql_handle) t
         where s.session_id = ${blockerId}
    `.execute(side));

    const percent = toNumber(request?.percent_complete);

    return {
        state: toText(request?.status),
        waitEvent: toText(request?.wait_type),
        blockedBy: toBlockers(blockers),
        workers: 0,
        progress: request?.command && percent
            ? { operation: request.command, phase: null, relation: null, done: null, total: null, percent }
            : null,
    };

};

interface MysqlProcessRow {
    state: string | null;
}

interface MysqlBlockerIdRow {
    pid: number;
}

interface MysqlStageRow {
    event_name: string;
    work_completed: number | null;
    work_estimated: number | null;
}

/**
 * MySQL: `information_schema.processlist`, the `sys` schema's lock-wait views,
 * and `performance_schema.events_stages_current`. The last two depend on
 * privileges and instrumentation and drop out quietly without them.
 */
const mysqlProbe: StatementProbe = async (side, id) => {

    const [process] = await rowsOrEmpty(() => sql<MysqlProcessRow>`
        select state from information_schema.processlist where id = ${id}
    `.execute(side));

    const blockerIds = await rowsOrEmpty(() => sql<MysqlBlockerIdRow>`
        select blocking_pid as pid from sys.innodb_lock_waits where waiting_pid = ${id}
        union
        select blocking_pid from sys.schema_table_lock_waits where waiting_pid = ${id}
    `.execute(side));

    const ids = blockerIds.map((row) => Number(row.pid));

    const blockers = ids.length === 0 ? [] : await rowsOrEmpty(() => sql<BlockerRow>`
        select id as pid, left(coalesce(info, command), 120) as query, time * 1000 as age_ms
          from information_schema.processlist
         where id in (${sql.join(ids)})
    `.execute(side));

    const [stage] = await rowsOrEmpty(() => sql<MysqlStageRow>`
        select s.event_name, s.work_completed, s.work_estimated
          from performance_schema.events_stages_current s
          join performance_schema.threads t on t.thread_id = s.thread_id
         where t.processlist_id = ${id}
    `.execute(side));

    const state = toText(process?.state);
    const done = toNumber(stage?.work_completed);
    const total = toNumber(stage?.work_estimated);

    return {
        state,
        waitEvent: state?.startsWith('Waiting') ? state : null,
        blockedBy: toBlockers(blockers),
        workers: 0,
        progress: stage
            ? {
                operation: stage.event_name.replace(/^stage\/\w+\//, ''),
                phase: null,
                relation: null,
                done,
                total,
                percent: percentOf(done, total),
            }
            : null,
    };

};

/** Probes by dialect; sqlite has none (see `SESSION_ID_SQL`). */
export const STATEMENT_PROBES: Partial<Record<Dialect, StatementProbe>> = {
    postgres: postgresProbe,
    mssql: mssqlProbe,
    mysql: mysqlProbe,
};
