/**
 * Data transfer types.
 *
 * Defines types for cross-database data transfer operations.
 * Supports same-dialect transfers with configurable conflict resolution.
 */

/**
 * Strategy for handling primary key conflicts during transfer.
 *
 * - `fail`: Abort on first conflict (default)
 * - `skip`: Skip conflicting rows, continue transfer
 * - `update`: Update existing rows with source data
 * - `replace`: Delete and re-insert conflicting rows
 */
export type ConflictStrategy = 'fail' | 'skip' | 'update' | 'replace';

/**
 * Options for data transfer operations.
 *
 * @example
 * ```typescript
 * const options: TransferOptions = {
 *     tables: ['users', 'posts'],
 *     onConflict: 'skip',
 *     batchSize: 5000,
 *     truncateFirst: false,
 * };
 * ```
 */
export interface TransferOptions {

    /** Tables to transfer. Empty = all user tables. */
    tables?: string[];

    /** How to handle primary key conflicts. Default: 'fail' */
    onConflict?: ConflictStrategy;

    /** Rows per batch for cross-server transfers. Default: 1000 */
    batchSize?: number;

    /** Disable foreign key checks during transfer. Default: true */
    disableForeignKeys?: boolean;

    /** Preserve identity/auto-increment values. Default: true */
    preserveIdentity?: boolean;

    /** Truncate destination tables before transfer. Default: false */
    truncateFirst?: boolean;

    /** Validate only, don't execute. Default: false */
    dryRun?: boolean;

}

/**
 * Plan for a single table transfer.
 */
export interface TransferTablePlan {

    /** Table name */
    name: string;

    /** Table schema (if applicable) */
    schema?: string;

    /** Estimated row count */
    rowCount: number;

    /** Whether table has identity/auto-increment column */
    hasIdentity: boolean;

    /** Identity column name if present */
    identityColumn?: string;

    /** Primary key columns */
    primaryKey: string[];

    /** All column names */
    columns: string[];

    /** Tables this table depends on (FK references) */
    dependsOn: string[];

}

/**
 * Complete transfer plan.
 *
 * Contains ordered list of tables and transfer metadata.
 */
export interface TransferPlan {

    /** Tables in dependency order (parents before children) */
    tables: TransferTablePlan[];

    /** Whether source and destination are on same server */
    sameServer: boolean;

    /** Total estimated rows across all tables */
    estimatedRows: number;

    /** Warnings about potential issues */
    warnings: string[];

}

/**
 * Result for a single table transfer.
 */
export interface TransferTableResult {

    /** Table name */
    table: string;

    /** Transfer status */
    status: 'success' | 'skipped' | 'failed';

    /** Rows successfully transferred */
    rowsTransferred: number;

    /** Rows skipped due to conflicts */
    rowsSkipped: number;

    /** Duration in milliseconds */
    durationMs: number;

    /** Error message if failed */
    error?: string;

}

/**
 * Complete transfer result.
 */
export interface TransferResult {

    /** Overall status */
    status: 'success' | 'partial' | 'failed';

    /** Results per table */
    tables: TransferTableResult[];

    /** Total rows transferred */
    totalRows: number;

    /** Total duration in milliseconds */
    durationMs: number;

}
