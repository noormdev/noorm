/**
 * SDK Types.
 *
 * All interfaces and types for the noorm programmatic SDK.
 */
import type { Kysely } from 'kysely';
import type { ObserverEngine } from '@logosdx/observer';

import type { Config } from '../core/config/types.js';
import type { Settings } from '../core/settings/index.js';
import type { Identity } from '../core/identity/index.js';
import type { Dialect } from '../core/connection/types.js';
import type { NoormEvents } from '../core/observer.js';
import type {
    TableSummary,
    TableDetail,
    ExploreOverview,
} from '../core/explore/index.js';
import type { TruncateResult, TeardownResult } from '../core/teardown/index.js';
import type { BatchResult, FileResult, RunOptions } from '../core/runner/index.js';
import type {
    ChangesetResult,
    BatchChangesetResult,
    ChangesetListItem,
    ChangesetOptions,
    ChangesetHistoryRecord,
} from '../core/changeset/index.js';
import type { Lock, LockStatus, LockOptions } from '../core/lock/index.js';
import type { ProcessResult as TemplateResult } from '../core/template/index.js';

// ─────────────────────────────────────────────────────────────
// Factory Options
// ─────────────────────────────────────────────────────────────

/**
 * Options for creating an SDK context.
 *
 * @example
 * ```typescript
 * // Basic usage with stored config
 * const ctx = await createContext({ config: 'dev' })
 *
 * // Require test database for safety
 * const ctx = await createContext({
 *     config: 'test',
 *     requireTest: true,
 * })
 *
 * // Allow destructive ops on protected config
 * const ctx = await createContext({
 *     config: 'staging',
 *     allowProtected: true,
 * })
 *
 * // Env-only mode (CI/CD) - no stored config needed
 * // Requires NOORM_CONNECTION_DIALECT and NOORM_CONNECTION_DATABASE
 * const ctx = await createContext()
 *
 * // Override stored config via NOORM_* env vars
 * // NOORM_CONNECTION_HOST=override.host
 * const ctx = await createContext({ config: 'prod' })
 * ```
 */
export interface CreateContextOptions<DB = unknown> {

    /**
     * Config name from state.
     *
     * If omitted:
     * - Uses `NOORM_CONFIG` env var if set
     * - Falls back to env-only mode if `NOORM_CONNECTION_DIALECT`
     *   and `NOORM_CONNECTION_DATABASE` are set
     */
    config?: string;

    /** Project root directory. Defaults to process.cwd() */
    projectRoot?: string;

    /** Refuse if config.isTest !== true. Default: false */
    requireTest?: boolean;

    /** Allow destructive ops on protected configs. Default: false */
    allowProtected?: boolean;

    /** Stage name for stage defaults (from settings.yml) */
    stage?: string;

}

// ─────────────────────────────────────────────────────────────
// SQL Execution Types
// ─────────────────────────────────────────────────────────────

/**
 * Result of an execute() call.
 */
export interface ExecuteResult {

    /** Number of rows affected (if available) */
    rowsAffected?: number;

}

/**
 * Transaction context for use within transaction callbacks.
 *
 * @example
 * ```typescript
 * await ctx.transaction(async (tx) => {
 *     const [user] = await tx.query('SELECT * FROM users WHERE id = $1', [id])
 *     await tx.execute('UPDATE users SET login_count = login_count + 1 WHERE id = $1', [id])
 *     return user
 * })
 * ```
 */
export interface TransactionContext {

    /**
     * Execute a SELECT query within the transaction.
     */
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

    /**
     * Execute an INSERT/UPDATE/DELETE within the transaction.
     */
    execute(sql: string, params?: unknown[]): Promise<ExecuteResult>;

}

// ─────────────────────────────────────────────────────────────
// Build Options
// ─────────────────────────────────────────────────────────────

/**
 * Options for build operations.
 */
export interface BuildOptions {

    /** Skip checksum checks, rebuild everything. Default: false */
    force?: boolean;

}

// ─────────────────────────────────────────────────────────────
// Context Interface
// ─────────────────────────────────────────────────────────────

/**
 * SDK Context interface.
 *
 * Provides programmatic access to all noorm operations.
 *
 * @example
 * ```typescript
 * const ctx = await createContext({ config: 'dev' })
 * await ctx.connect()
 *
 * // Run queries
 * const users = await ctx.query<User>('SELECT * FROM users')
 *
 * // Execute SQL files
 * await ctx.runFile('./seeds/users.sql')
 *
 * // Apply changesets
 * await ctx.fastForward()
 *
 * await ctx.disconnect()
 * ```
 */
export interface Context<DB = unknown> {

    // ─────────────────────────────────────────────────────────
    // Read-only Properties
    // ─────────────────────────────────────────────────────────

    /** The loaded config */
    readonly config: Config;

    /** The loaded settings */
    readonly settings: Settings;

    /** The resolved identity */
    readonly identity: Identity;

    /** The Kysely database instance (requires connect()) */
    readonly kysely: Kysely<DB>;

    /** The database dialect */
    readonly dialect: Dialect;

    /** Whether currently connected */
    readonly connected: boolean;

    /**
     * Event observer for subscribing to core events.
     *
     * @example
     * ```typescript
     * ctx.observer.on('file:after', (event) => {
     *     console.log(`Executed ${event.filepath} in ${event.durationMs}ms`)
     * })
     * ```
     */
    readonly observer: ObserverEngine<NoormEvents>;

    // ─────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────

    /**
     * Connect to the database.
     *
     * @example
     * ```typescript
     * const ctx = await createContext({ config: 'dev' })
     * await ctx.connect()
     * // ... use ctx
     * await ctx.disconnect()
     * ```
     */
    connect(): Promise<void>;

    /**
     * Disconnect from the database.
     */
    disconnect(): Promise<void>;

    // ─────────────────────────────────────────────────────────
    // SQL Execution
    // ─────────────────────────────────────────────────────────

    /**
     * Execute a SELECT query.
     *
     * @param sql - SQL query string
     * @param params - Query parameters
     * @returns Array of result rows
     *
     * @example
     * ```typescript
     * const users = await ctx.query<User>('SELECT * FROM users WHERE active = $1', [true])
     * ```
     */
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

    /**
     * Execute an INSERT/UPDATE/DELETE statement.
     *
     * @param sql - SQL statement
     * @param params - Statement parameters
     * @returns Execution result with affected rows
     *
     * @example
     * ```typescript
     * const result = await ctx.execute('DELETE FROM sessions WHERE expires_at < NOW()')
     * console.log(`Deleted ${result.rowsAffected} sessions`)
     * ```
     */
    execute(sql: string, params?: unknown[]): Promise<ExecuteResult>;

    /**
     * Execute operations within a transaction.
     *
     * @param fn - Transaction callback
     * @returns Result from the callback
     *
     * @example
     * ```typescript
     * const result = await ctx.transaction(async (tx) => {
     *     await tx.execute('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, from])
     *     await tx.execute('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, to])
     *     return { transferred: 100 }
     * })
     * ```
     */
    transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;

    // ─────────────────────────────────────────────────────────
    // Explore
    // ─────────────────────────────────────────────────────────

    /**
     * List all tables in the database.
     *
     * @returns Array of table summaries
     */
    listTables(): Promise<TableSummary[]>;

    /**
     * Get detailed information about a table.
     *
     * @param name - Table name
     * @param schema - Optional schema name
     * @returns Table detail or null if not found
     */
    describeTable(name: string, schema?: string): Promise<TableDetail | null>;

    /**
     * Get database overview with counts of all object types.
     *
     * @returns Overview with counts
     */
    overview(): Promise<ExploreOverview>;

    // ─────────────────────────────────────────────────────────
    // Schema Operations
    // ─────────────────────────────────────────────────────────

    /**
     * Truncate all tables (preserving schema).
     *
     * @returns Truncate result with affected tables
     */
    truncate(): Promise<TruncateResult>;

    /**
     * Drop all database objects (except noorm tracking tables).
     *
     * @returns Teardown result with dropped objects
     */
    teardown(): Promise<TeardownResult>;

    /**
     * Build schema by executing all SQL files in the schema directory.
     *
     * @param options - Build options
     * @returns Batch result with file execution details
     */
    build(options?: BuildOptions): Promise<BatchResult>;

    /**
     * Reset database: teardown + build.
     *
     * Drops all objects then rebuilds schema from scratch.
     */
    reset(): Promise<void>;

    // ─────────────────────────────────────────────────────────
    // File Runner
    // ─────────────────────────────────────────────────────────

    /**
     * Execute a single SQL file.
     *
     * @param filepath - Path to SQL file (relative to project root)
     * @param options - Run options
     * @returns File execution result
     */
    runFile(filepath: string, options?: RunOptions): Promise<FileResult>;

    /**
     * Execute multiple SQL files sequentially.
     *
     * @param filepaths - Paths to SQL files
     * @param options - Run options
     * @returns Batch result with all file results
     */
    runFiles(filepaths: string[], options?: RunOptions): Promise<BatchResult>;

    /**
     * Execute all SQL files in a directory.
     *
     * @param dirpath - Path to directory
     * @param options - Run options
     * @returns Batch result with all file results
     */
    runDir(dirpath: string, options?: RunOptions): Promise<BatchResult>;

    // ─────────────────────────────────────────────────────────
    // Changesets
    // ─────────────────────────────────────────────────────────

    /**
     * Apply a specific changeset.
     *
     * @param name - Changeset name
     * @param options - Changeset options
     * @returns Changeset execution result
     */
    applyChangeset(name: string, options?: ChangesetOptions): Promise<ChangesetResult>;

    /**
     * Revert a specific changeset.
     *
     * @param name - Changeset name
     * @param options - Changeset options
     * @returns Changeset execution result
     */
    revertChangeset(name: string, options?: ChangesetOptions): Promise<ChangesetResult>;

    /**
     * Apply all pending changesets.
     *
     * @returns Batch result with all changeset results
     */
    fastForward(): Promise<BatchChangesetResult>;

    /**
     * Get status of all changesets.
     *
     * @returns Array of changeset list items with status
     */
    getChangesetStatus(): Promise<ChangesetListItem[]>;

    /**
     * Get only pending changesets.
     *
     * @returns Array of pending changeset list items
     */
    getPendingChangesets(): Promise<ChangesetListItem[]>;

    // ─────────────────────────────────────────────────────────
    // Secrets
    // ─────────────────────────────────────────────────────────

    /**
     * Get a config-scoped secret.
     *
     * @param key - Secret key
     * @returns Secret value or undefined if not set
     */
    getSecret(key: string): string | undefined;

    // ─────────────────────────────────────────────────────────
    // Locks
    // ─────────────────────────────────────────────────────────

    /**
     * Acquire a database lock.
     *
     * @param options - Lock options (timeout, etc.)
     * @returns The acquired lock
     * @throws LockAcquireError if lock is held by another identity
     */
    acquireLock(options?: LockOptions): Promise<Lock>;

    /**
     * Release the current lock.
     */
    releaseLock(): Promise<void>;

    /**
     * Get current lock status.
     *
     * @returns Lock status with isLocked flag and lock details
     */
    getLockStatus(): Promise<LockStatus>;

    /**
     * Execute an operation with automatic lock acquisition and release.
     *
     * @param fn - Operation to execute while holding the lock
     * @param options - Lock options
     * @returns Result from the operation
     *
     * @example
     * ```typescript
     * await ctx.withLock(async () => {
     *     await ctx.build()
     *     await ctx.fastForward()
     * })
     * ```
     */
    withLock<T>(fn: () => Promise<T>, options?: LockOptions): Promise<T>;

    // ─────────────────────────────────────────────────────────
    // Templates
    // ─────────────────────────────────────────────────────────

    /**
     * Render a template file without executing.
     *
     * @param filepath - Path to template file
     * @returns Rendered SQL content
     *
     * @example
     * ```typescript
     * const result = await ctx.renderTemplate('schema/001_users.sql.tmpl')
     * console.log(result.sql)
     * ```
     */
    renderTemplate(filepath: string): Promise<TemplateResult>;

    // ─────────────────────────────────────────────────────────
    // History
    // ─────────────────────────────────────────────────────────

    /**
     * Get execution history.
     *
     * @param limit - Maximum records to return
     * @returns Array of history records
     */
    getHistory(limit?: number): Promise<ChangesetHistoryRecord[]>;

    // ─────────────────────────────────────────────────────────
    // Utilities
    // ─────────────────────────────────────────────────────────

    /**
     * Compute checksum for a file.
     *
     * Useful for custom change detection logic.
     *
     * @param filepath - Path to file
     * @returns SHA-256 checksum
     */
    computeChecksum(filepath: string): Promise<string>;

    /**
     * Test if the connection can be established.
     *
     * Does not require connect() to be called first.
     *
     * @returns Object with ok status and optional error message
     */
    testConnection(): Promise<{ ok: boolean; error?: string }>;

}
