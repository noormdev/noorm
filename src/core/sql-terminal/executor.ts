/**
 * SQL Terminal Executor.
 *
 * Executes raw SQL queries via Kysely and returns structured results.
 */
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import { observer } from '../observer.js';
import { assertPolicy, classifyStatements } from '../policy/index.js';
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
 * @returns Execution result with columns, rows, and metadata
 */
export async function executeRawSqlUnchecked(
    db: Kysely<unknown>,
    query: string,
    configName: string,
): Promise<SqlExecutionResult> {

    const start = performance.now();

    observer.emit('sql-terminal:execute:before', { query, configName });

    const [result, err] = await attempt(() =>
        sql.raw(query).execute(db),
    );

    const durationMs = performance.now() - start;

    if (err) {

        const errorMessage = err instanceof Error ? err.message : String(err);

        observer.emit('sql-terminal:execute:after', {
            query,
            configName,
            success: false,
            durationMs,
            error: errorMessage,
        });

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
): Promise<SqlExecutionResult> {

    const statementClass = classifyStatements(query, gate.dialect);

    assertPolicy(gate.channel, { name: configName, access: gate.access }, CLASS_PERMISSION[statementClass]);

    return executeRawSqlUnchecked(db, query, configName);

}
