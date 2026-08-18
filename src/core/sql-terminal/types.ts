/**
 * SQL Terminal type definitions.
 *
 * Types for SQL history entries, execution results, and history file structure.
 */

/**
 * A single SQL query history entry.
 *
 * Stores metadata about an executed query. Results are stored
 * separately in gzipped files referenced by `resultsFile`.
 */
export interface SqlHistoryEntry {

    /** Unique identifier (UUID v4) */
    id: string;

    /** The SQL query that was executed */
    query: string;

    /** Timestamp of execution */
    executedAt: Date;

    /** Execution duration in milliseconds */
    durationMs: number;

    /** Whether execution succeeded */
    success: boolean;

    /** Error message if execution failed */
    errorMessage?: string;

    /** Row count returned (SELECT) or affected (INSERT/UPDATE/DELETE) */
    rowCount?: number;

    /** Path to gzipped results file (relative to config results dir) */
    resultsFile?: string;

}

/**
 * SQL execution result.
 *
 * Contains the full result data including columns and rows.
 * This is what gets serialized to gzipped results files.
 */
export interface SqlExecutionResult {

    /** Whether execution succeeded */
    success: boolean;

    /** Error message if execution failed */
    errorMessage?: string;

    /** Column names from result set */
    columns?: string[];

    /** Row data as array of objects */
    rows?: Record<string, unknown>[];

    /** Rows affected (for INSERT/UPDATE/DELETE) */
    rowsAffected?: number;

    /** Execution duration in milliseconds */
    durationMs: number;

    /**
     * How an execution ended when the caller stopped waiting. Absent when the
     * query ran to completion, whether it succeeded or failed.
     *
     * `server-cancel-requested` means a cancel was sent to the database on a
     * second connection, so the query is being stopped there. `stopped-waiting`
     * means only the client let go: the query may well still be running and
     * holding resources. The distinction exists so the UI can say which one
     * happened rather than calling both of them "cancelled".
     */
    aborted?: 'server-cancel-requested' | 'stopped-waiting';

}

/**
 * History file structure.
 *
 * Stored at `.noorm/state/history/{configName}.json`.
 */
export interface SqlHistoryFile {

    /** Schema version for migrations */
    version: string;

    /** History entries (newest first) */
    entries: SqlHistoryEntry[];

}

/**
 * Serialized history entry for JSON storage.
 *
 * Dates are stored as ISO strings.
 */
export interface SqlHistoryEntrySerialized {

    id: string;
    query: string;
    executedAt: string;
    durationMs: number;
    success: boolean;
    errorMessage?: string;
    rowCount?: number;
    resultsFile?: string;

}

/**
 * Serialized history file for JSON storage.
 */
export interface SqlHistoryFileSerialized {

    version: string;
    entries: SqlHistoryEntrySerialized[];

}

/**
 * Result of a clear operation.
 */
export interface ClearResult {

    /** Number of history entries removed */
    entriesRemoved: number;

    /** Number of result files deleted */
    filesRemoved: number;

}
