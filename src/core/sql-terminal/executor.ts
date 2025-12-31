/**
 * SQL Terminal Executor.
 *
 * Executes raw SQL queries via Kysely and returns structured results.
 */
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import { observer } from '../observer.js';
import type { SqlExecutionResult } from './types.js';

/**
 * Execute raw SQL and return structured results.
 *
 * Uses Kysely's `sql.raw()` to execute arbitrary SQL.
 * Emits observer events before and after execution.
 *
 * @param db - Kysely database instance
 * @param query - Raw SQL query to execute
 * @param configName - Config name for event context
 * @returns Execution result with columns, rows, and metadata
 *
 * @example
 * ```typescript
 * const result = await executeRawSql(db, 'SELECT * FROM users LIMIT 10', 'production')
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
    const rowsAffected = result!.numAffectedRows
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
