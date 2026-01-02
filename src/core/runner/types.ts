/**
 * Runner module types.
 *
 * Defines interfaces for SQL file execution, tracking, and results.
 *
 * WHY: Centralized type definitions ensure consistency across
 * runner, tracker, and consumer code.
 */
import type { Kysely } from 'kysely';

import type { NoormDatabase, ExecutionStatus } from '../shared/index.js';
import type { Identity } from '../identity/index.js';

// ─────────────────────────────────────────────────────────────
// Run Options
// ─────────────────────────────────────────────────────────────

/**
 * Options for running SQL files.
 *
 * @example
 * ```typescript
 * const options: RunOptions = {
 *     force: true,        // Re-run even if unchanged
 *     abortOnError: false // Continue on failures
 * }
 * ```
 */
export interface RunOptions {
    /** Re-run files even if unchanged. Default: false */
    force?: boolean;

    /** Number of files to run in parallel. Default: 1 (sequential for DDL safety) */
    concurrency?: number;

    /** Stop execution on first failure. Default: true */
    abortOnError?: boolean;

    /** Report what would run without executing. Default: false */
    dryRun?: boolean;

    /** Output rendered SQL without executing. Default: false */
    preview?: boolean;

    /** Write preview output to file instead of stdout. Default: null */
    output?: string | null;
}

/**
 * Default run options.
 */
export const DEFAULT_RUN_OPTIONS: Required<Omit<RunOptions, 'output'>> & { output: string | null } =
    {
        force: false,
        concurrency: 1,
        abortOnError: true,
        dryRun: false,
        preview: false,
        output: null,
    };

// ─────────────────────────────────────────────────────────────
// Run Context
// ─────────────────────────────────────────────────────────────

/**
 * Context required to run SQL files.
 *
 * Passed to the runner to provide database connection, identity,
 * config info, and template rendering context.
 *
 * @example
 * ```typescript
 * const context: RunContext = {
 *     db,
 *     configName: 'dev',
 *     identity: { name: 'Alice', email: 'alice@example.com' },
 *     projectRoot: '/project',
 * }
 * ```
 */
export interface RunContext {
    /** Kysely database connection */
    db: Kysely<NoormDatabase>;

    /** Name of the active config */
    configName: string;

    /** User identity for tracking */
    identity: Identity;

    /** Project root for template resolution */
    projectRoot: string;

    /** Config object for template context */
    config?: Record<string, unknown>;

    /** Secrets for template context */
    secrets?: Record<string, string>;

    /** Global secrets for template context */
    globalSecrets?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────
// File Result
// ─────────────────────────────────────────────────────────────

/**
 * Why a file was skipped.
 */
export type SkipReason = 'unchanged' | 'already-run';

/**
 * Result of executing a single file.
 *
 * @example
 * ```typescript
 * const result: FileResult = {
 *     filepath: '/project/sql/001.sql',
 *     checksum: 'abc123...',
 *     status: 'success',
 *     durationMs: 42,
 * }
 * ```
 */
export interface FileResult {
    /** Absolute path to the file */
    filepath: string;

    /** SHA-256 hash of file contents */
    checksum: string;

    /** Execution status */
    status: ExecutionStatus;

    /** Why the file was skipped (only when status is 'skipped') */
    skipReason?: SkipReason;

    /** Execution time in milliseconds */
    durationMs?: number;

    /** Error message if failed */
    error?: string;

    /** Rendered SQL (only in preview mode) */
    renderedSql?: string;
}

// ─────────────────────────────────────────────────────────────
// Build/Run Results
// ─────────────────────────────────────────────────────────────

/**
 * Overall status of a batch operation.
 */
export type BatchStatus = 'success' | 'failed' | 'partial';

/**
 * Result of a batch operation (build, dir).
 *
 * @example
 * ```typescript
 * const result: BatchResult = {
 *     status: 'success',
 *     files: [...],
 *     filesRun: 5,
 *     filesSkipped: 2,
 *     filesFailed: 0,
 *     durationMs: 1234,
 * }
 * ```
 */
export interface BatchResult {
    /** Overall status */
    status: BatchStatus;

    /** Results for each file */
    files: FileResult[];

    /** Number of files executed */
    filesRun: number;

    /** Number of files skipped */
    filesSkipped: number;

    /** Number of files that failed */
    filesFailed: number;

    /** Total execution time in milliseconds */
    durationMs: number;

    /** Changeset ID in tracking table */
    changesetId?: number;
}

// ─────────────────────────────────────────────────────────────
// Change Detection
// ─────────────────────────────────────────────────────────────

/**
 * Why a file needs to run.
 */
export type RunReason = 'new' | 'changed' | 'failed' | 'stale' | 'force';

/**
 * Result of checking if a file needs to run.
 */
export interface NeedsRunResult {
    /** Whether the file needs to run */
    needsRun: boolean;

    /** Why it needs to run (if needsRun is true) */
    reason?: RunReason;

    /** Why it was skipped (if needsRun is false) */
    skipReason?: SkipReason;

    /** Previous checksum if exists */
    previousChecksum?: string;
}

// ─────────────────────────────────────────────────────────────
// Tracker Types
// ─────────────────────────────────────────────────────────────

/**
 * Data for creating a new operation record.
 */
export interface CreateOperationData {
    /** Operation name (e.g., 'build:2024-01-15T10:30:00') */
    name: string;

    /** 'build' or 'run' */
    changeType: 'build' | 'run';

    /** Config name */
    configName: string;

    /** Identity string */
    executedBy: string;
}

/**
 * Data for recording a file execution.
 */
export interface RecordExecutionData {
    /** Parent operation ID */
    changesetId: number;

    /** File path */
    filepath: string;

    /** File checksum */
    checksum: string;

    /** Execution status */
    status: ExecutionStatus;

    /** Skip reason if skipped */
    skipReason?: string;

    /** Error message if failed */
    errorMessage?: string;

    /** Duration in milliseconds */
    durationMs?: number;
}
