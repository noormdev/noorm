/**
 * Lock manager for preventing concurrent database operations.
 *
 * Uses table-based locking via the noorm lock table to prevent race conditions
 * when multiple processes try to modify the same database.
 *
 * @example
 * ```typescript
 * const manager = getLockManager()
 *
 * // Acquire lock before running migrations
 * await manager.withLock(db, 'dev', 'alice@example.com', async () => {
 *     await runMigrations()
 * })
 *
 * // Or manual acquire/release
 * const lock = await manager.acquire(db, 'dev', 'alice@example.com')
 * try {
 *     await runMigrations()
 * }
 * finally {
 *     await manager.release(db, 'dev', 'alice@example.com', 'postgres')
 * }
 * ```
 */
import { attempt, wait } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import { observer } from '../observer.js';
import { getNoormTables, noormDb, type NoormDatabase } from '../shared/index.js';
import type { Dialect } from '../connection/types.js';
import type { Lock, LockOptions, LockStatus } from './types.js';
import { DEFAULT_LOCK_OPTIONS } from './types.js';
import {
    LockAcquireError,
    LockExpiredError,
    LockNotFoundError,
    LockOwnershipError,
} from './errors.js';

// ─────────────────────────────────────────────────────────────
// Dialect-aware date helpers
// ─────────────────────────────────────────────────────────────

/**
 * Format a Date for database storage based on dialect.
 *
 * SQLite stores dates as TEXT (ISO strings), while other dialects
 * can bind Date objects directly.
 */
function formatDateForDialect(date: Date, dialect: Dialect): Date | string {

    if (dialect === 'sqlite') {

        return date.toISOString();

    }

    return date;

}

/**
 * Manages database locks for concurrent operation protection.
 */
class LockManager {

    /**
     * Acquire a lock for a config.
     *
     * If the lock is held by another identity and wait=false, throws LockAcquireError.
     * If wait=true, polls until lock is available or waitTimeout is exceeded.
     *
     * @param db - Kysely database instance
     * @param configName - Config/database scope for the lock
     * @param identity - Identity string of the requester
     * @param options - Lock options
     * @returns Lock state on success
     * @throws LockAcquireError if lock cannot be acquired
     */
    async acquire(
        db: Kysely<NoormDatabase>,
        configName: string,
        identity: string,
        options: LockOptions = {},
    ): Promise<Lock> {

        // Declaration
        const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
        const startTime = Date.now();

        // Emit acquiring event
        observer.emit('lock:acquiring', { configName, identity });

        // Business Logic
        while (true) {

            // Clean up expired locks first
            await this.cleanupExpired(db, configName, opts.dialect);

            // Try to get existing lock
            const existing = await this.getLock(db, configName, opts.dialect);

            if (!existing) {

                // No lock exists, create one
                const lock = await this.createLock(db, configName, identity, opts);
                observer.emit('lock:acquired', {
                    configName,
                    identity,
                    expiresAt: lock.expiresAt,
                });

                return lock;

            }

            // Lock exists and is not expired (cleanup already ran)
            // Check if it's ours
            if (existing.lockedBy === identity) {

                // We already hold the lock - extend it
                const lock = await this.extendLock(db, configName, identity, opts);
                observer.emit('lock:acquired', {
                    configName,
                    identity,
                    expiresAt: lock.expiresAt,
                });

                return lock;

            }

            // Lock held by someone else
            observer.emit('lock:blocked', {
                configName,
                holder: existing.lockedBy,
                heldSince: existing.lockedAt,
            });

            if (!opts.wait) {

                throw new LockAcquireError(
                    configName,
                    existing.lockedBy,
                    existing.lockedAt,
                    existing.expiresAt,
                    existing.reason,
                );

            }

            // Check wait timeout
            const elapsed = Date.now() - startTime;
            if (elapsed >= opts.waitTimeout) {

                throw new LockAcquireError(
                    configName,
                    existing.lockedBy,
                    existing.lockedAt,
                    existing.expiresAt,
                    existing.reason,
                );

            }

            // Wait and retry
            await wait(opts.pollInterval);

        }

    }

    /**
     * Release a lock.
     *
     * @param db - Kysely database instance
     * @param configName - Config/database scope
     * @param identity - Identity of the lock holder
     * @param dialect - Database dialect for schema-aware table resolution
     * @throws LockNotFoundError if no lock exists
     * @throws LockOwnershipError if lock is held by someone else
     */
    async release(
        db: Kysely<NoormDatabase>,
        configName: string,
        identity: string,
        dialect: Dialect,
    ): Promise<void> {

        const ndb = noormDb(db, dialect);
        const tables = getNoormTables(dialect);

        // Check existing lock
        const existing = await this.getLock(db, configName, dialect);

        if (!existing) {

            throw new LockNotFoundError(configName, identity);

        }

        if (existing.lockedBy !== identity) {

            throw new LockOwnershipError(configName, identity, existing.lockedBy);

        }

        // Delete the lock
        await ndb
            .deleteFrom(tables.lock)
            .where('config_name', '=', configName)
            .where('locked_by', '=', identity)
            .execute();

        observer.emit('lock:released', { configName, identity });

    }

    /**
     * Force release a lock regardless of owner.
     *
     * Use with caution - this bypasses ownership checks.
     * Intended for admin/CLI force-release commands.
     *
     * @param db - Kysely database instance
     * @param configName - Config/database scope
     * @param dialect - Database dialect for schema-aware table resolution
     * @returns true if a lock was released, false if none existed
     */
    async forceRelease(
        db: Kysely<NoormDatabase>,
        configName: string,
        dialect: Dialect,
    ): Promise<boolean> {

        const ndb = noormDb(db, dialect);
        const tables = getNoormTables(dialect);
        const existing = await this.getLock(db, configName, dialect);
        if (!existing) {

            return false;

        }

        await ndb.deleteFrom(tables.lock).where('config_name', '=', configName).execute();

        observer.emit('lock:released', {
            configName,
            identity: existing.lockedBy,
        });

        return true;

    }

    /**
     * Execute an operation while holding a lock.
     *
     * Acquires the lock, runs the operation, and releases the lock.
     * Lock is released even if the operation throws.
     *
     * @param db - Kysely database instance
     * @param configName - Config/database scope
     * @param identity - Identity string
     * @param operation - Async function to execute
     * @param options - Lock options
     * @returns Result of the operation
     */
    async withLock<T>(
        db: Kysely<NoormDatabase>,
        configName: string,
        identity: string,
        operation: () => Promise<T>,
        options: LockOptions = {},
    ): Promise<T> {

        const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };

        await this.acquire(db, configName, identity, options);

        try {

            return await operation();

        }
        finally {

            const [, err] = await attempt(() => this.release(db, configName, identity, opts.dialect));

            if (err) {

                // Log but don't throw - the operation result matters more
                observer.emit('error', {
                    source: 'lock',
                    error: err,
                    context: { configName, identity },
                });

            }

        }

    }

    /**
     * Validate that a lock is still held by the given identity.
     *
     * Use this before critical operations to ensure the lock hasn't expired.
     *
     * @param db - Kysely database instance
     * @param configName - Config/database scope
     * @param identity - Expected lock holder
     * @param dialect - Database dialect for schema-aware table resolution
     * @throws LockExpiredError if lock has expired
     * @throws LockOwnershipError if lock is held by someone else
     * @throws LockNotFoundError if no lock exists
     */
    async validate(
        db: Kysely<NoormDatabase>,
        configName: string,
        identity: string,
        dialect: Dialect = 'postgres',
    ): Promise<void> {

        const existing = await this.getLock(db, configName, dialect);

        if (!existing) {

            throw new LockNotFoundError(configName, identity);

        }

        if (existing.lockedBy !== identity) {

            throw new LockOwnershipError(configName, identity, existing.lockedBy);

        }

        if (existing.expiresAt < new Date()) {

            // Clean it up
            await this.cleanupExpired(db, configName, dialect);

            throw new LockExpiredError(configName, identity, existing.expiresAt);

        }

    }

    /**
     * Extend a lock's expiration time.
     *
     * @param db - Kysely database instance
     * @param configName - Config/database scope
     * @param identity - Lock holder identity
     * @param options - Lock options (uses timeout for extension)
     * @returns Updated lock state
     */
    async extend(
        db: Kysely<NoormDatabase>,
        configName: string,
        identity: string,
        options: LockOptions = {},
    ): Promise<Lock> {

        const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };

        // Validate first
        await this.validate(db, configName, identity, opts.dialect);

        return this.extendLock(db, configName, identity, options);

    }

    /**
     * Get the current lock status for a config.
     *
     * @param db - Kysely database instance
     * @param configName - Config/database scope
     * @param dialect - Database dialect for date formatting
     * @returns Lock status with isLocked flag and lock details
     */
    async status(
        db: Kysely<NoormDatabase>,
        configName: string,
        dialect: Dialect = 'postgres',
    ): Promise<LockStatus> {

        // Clean up expired first
        await this.cleanupExpired(db, configName, dialect);

        const lock = await this.getLock(db, configName, dialect);

        return {
            isLocked: lock !== null,
            lock,
        };

    }

    // ─────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────

    /**
     * Get lock from database, or null if none exists.
     */
    private async getLock(
        db: Kysely<NoormDatabase>,
        configName: string,
        dialect: Dialect,
    ): Promise<Lock | null> {

        const ndb = noormDb(db, dialect);
        const tables = getNoormTables(dialect);

        const row = await ndb
            .selectFrom(tables.lock)
            .selectAll()
            .where('config_name', '=', configName)
            .executeTakeFirst();

        if (!row) {

            return null;

        }

        return {
            lockedBy: row.locked_by,
            lockedAt: new Date(row.locked_at),
            expiresAt: new Date(row.expires_at),
            reason: row.reason || undefined,
        };

    }

    /**
     * Create a new lock in the database.
     */
    private async createLock(
        db: Kysely<NoormDatabase>,
        configName: string,
        identity: string,
        opts: Required<Omit<LockOptions, 'reason'>> & { reason?: string },
    ): Promise<Lock> {

        const ndb = noormDb(db, opts.dialect);
        const tables = getNoormTables(opts.dialect);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + opts.timeout);

        await ndb
            .insertInto(tables.lock)
            .values({
                config_name: configName,
                locked_by: identity,
                locked_at: formatDateForDialect(now, opts.dialect) as Date,
                expires_at: formatDateForDialect(expiresAt, opts.dialect) as Date,
                reason: opts.reason ?? '',
            })
            .execute();

        return {
            lockedBy: identity,
            lockedAt: now,
            expiresAt,
            reason: opts.reason,
        };

    }

    /**
     * Extend an existing lock.
     */
    private async extendLock(
        db: Kysely<NoormDatabase>,
        configName: string,
        identity: string,
        opts: Partial<LockOptions>,
    ): Promise<Lock> {

        const dialect = opts.dialect ?? DEFAULT_LOCK_OPTIONS.dialect;
        const timeout = opts.timeout ?? DEFAULT_LOCK_OPTIONS.timeout;
        const ndb = noormDb(db, dialect);
        const tables = getNoormTables(dialect);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + timeout);

        const updateValues: Record<string, Date | string | undefined> = {
            expires_at: formatDateForDialect(expiresAt, dialect),
        };

        if (opts.reason !== undefined) {

            updateValues['reason'] = opts.reason;

        }

        await ndb
            .updateTable(tables.lock)
            .set(updateValues as Record<string, string>)
            .where('config_name', '=', configName)
            .where('locked_by', '=', identity)
            .execute();

        // Fetch the updated lock
        const lock = await this.getLock(db, configName, dialect);

        return lock!;

    }

    /**
     * Clean up expired locks.
     */
    private async cleanupExpired(
        db: Kysely<NoormDatabase>,
        configName: string,
        dialect: Dialect = 'postgres',
    ): Promise<void> {

        const ndb = noormDb(db, dialect);
        const tables = getNoormTables(dialect);
        const now = new Date();
        const nowForDb = formatDateForDialect(now, dialect);

        // Get expired lock info for event
        const expired = await ndb
            .selectFrom(tables.lock)
            .select(['locked_by'])
            .where('config_name', '=', configName)
            .where('expires_at', '<', nowForDb as Date)
            .executeTakeFirst();

        if (expired) {

            await ndb
                .deleteFrom(tables.lock)
                .where('config_name', '=', configName)
                .where('expires_at', '<', nowForDb as Date)
                .execute();

            observer.emit('lock:expired', {
                configName,
                previousHolder: expired.locked_by,
            });

        }

    }

}

// ─────────────────────────────────────────────────────────────
// Module singleton
// ─────────────────────────────────────────────────────────────

let instance: LockManager | null = null;

/**
 * Get the global LockManager instance.
 *
 * @example
 * ```typescript
 * const lockManager = getLockManager()
 * await lockManager.withLock(db, 'dev', 'alice', async () => {
 *     await runMigrations()
 * })
 * ```
 */
export function getLockManager(): LockManager {

    if (!instance) {

        instance = new LockManager();

    }

    return instance;

}

/**
 * Reset the global LockManager instance.
 *
 * Primarily for testing.
 */
export function resetLockManager(): void {

    instance = null;

}

// Export class for typing
export { LockManager };
