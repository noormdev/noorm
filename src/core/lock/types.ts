/**
 * Lock manager types.
 *
 * Defines the shape of locks and options for acquiring them.
 * Used to prevent concurrent operations on the same database.
 *
 * WHY: Concurrent DDL operations can corrupt database state.
 * Locks ensure only one process modifies the schema at a time.
 */

/**
 * Lock state returned after acquisition.
 *
 * @example
 * ```typescript
 * const lock = await lockManager.acquire('dev', 'alice@example.com')
 * console.log(lock.lockedBy)   // 'alice@example.com'
 * console.log(lock.expiresAt)  // Date object
 * ```
 */
export interface Lock {
    /** Identity string of holder */
    lockedBy: string;

    /** When acquired */
    lockedAt: Date;

    /** Auto-expiry time */
    expiresAt: Date;

    /** Optional reason for acquiring */
    reason?: string;
}

/**
 * Options for acquiring a lock.
 *
 * @example
 * ```typescript
 * // Wait up to 30s for lock, polling every 500ms
 * const options: LockOptions = {
 *     timeout: 60_000,        // Lock expires after 60s
 *     wait: true,             // Block until available
 *     waitTimeout: 30_000,    // Max wait time
 *     pollInterval: 500,      // Check every 500ms
 *     reason: 'Running migrations',
 * }
 * ```
 */
export interface LockOptions {
    /**
     * Database dialect for date formatting.
     *
     * SQLite stores dates as ISO strings, other dialects can use Date objects.
     * @default 'postgres'
     */
    dialect?: 'postgres' | 'mysql' | 'sqlite' | 'mssql';

    /**
     * Lock duration in milliseconds.
     *
     * After this time, the lock expires and can be claimed by others.
     * @default 300_000 (5 minutes)
     */
    timeout?: number;

    /**
     * Block until lock is available?
     *
     * If true, will poll until the lock is acquired or waitTimeout is reached.
     * @default false
     */
    wait?: boolean;

    /**
     * Max time to wait for lock in milliseconds.
     *
     * Only used if wait is true.
     * @default 30_000 (30 seconds)
     */
    waitTimeout?: number;

    /**
     * How often to poll when waiting, in milliseconds.
     *
     * Only used if wait is true.
     * @default 1_000 (1 second)
     */
    pollInterval?: number;

    /**
     * Optional reason for acquiring the lock.
     *
     * Shown to users who are blocked by this lock.
     */
    reason?: string;
}

/**
 * Result of a lock status check.
 */
export interface LockStatus {
    /** Whether the lock is currently held */
    isLocked: boolean;

    /** Lock details if held, null if not */
    lock: Lock | null;
}

/**
 * Default lock options.
 */
export const DEFAULT_LOCK_OPTIONS: Required<Omit<LockOptions, 'reason'>> = {
    dialect: 'postgres',
    timeout: 5 * 60 * 1000, // 5 minutes
    wait: false,
    waitTimeout: 30 * 1000, // 30 seconds
    pollInterval: 1000, // 1 second
};
