/**
 * Lock manager tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import {
    getLockManager,
    resetLockManager,
    LockAcquireError,
    LockNotFoundError,
    LockOwnershipError,
    LockExpiredError,
} from '../../../src/core/lock/index.js';
import { NOORM_TABLES, type NoormDatabase } from '../../../src/core/shared/index.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { LockOptions } from '../../../src/core/lock/types.js';

// SQLite dialect option for all lock operations in tests
const sqliteOpts: LockOptions = { dialect: 'sqlite' };

/**
 * Create a test database with schema.
 */
async function createTestDb(): Promise<Kysely<NoormDatabase>> {

    const db = new Kysely<NoormDatabase>({
        dialect: new SqliteDialect({
            database: new Database(':memory:'),
        }),
    });

    // Run schema migration to create tables
    await v1.up(db);

    return db;

}

describe('lock: manager', () => {

    let db: Kysely<NoormDatabase>;

    beforeEach(async () => {

        resetLockManager();
        db = await createTestDb();

    });

    afterEach(async () => {

        resetLockManager();
        await db.destroy();

    });

    describe('singleton', () => {

        it('should return same instance on multiple calls', () => {

            const manager1 = getLockManager();
            const manager2 = getLockManager();

            expect(manager1).toBe(manager2);

        });

        it('should return new instance after reset', () => {

            const manager1 = getLockManager();
            resetLockManager();
            const manager2 = getLockManager();

            expect(manager1).not.toBe(manager2);

        });

    });

    describe('acquire', () => {

        it('should acquire a lock successfully', async () => {

            const manager = getLockManager();

            const lock = await manager.acquire(db, 'dev', 'alice@example.com', sqliteOpts);

            expect(lock.lockedBy).toBe('alice@example.com');
            expect(lock.lockedAt).toBeInstanceOf(Date);
            expect(lock.expiresAt).toBeInstanceOf(Date);
            expect(lock.expiresAt.getTime()).toBeGreaterThan(lock.lockedAt.getTime());

        });

        it('should store lock in database', async () => {

            const manager = getLockManager();

            await manager.acquire(db, 'dev', 'alice@example.com', sqliteOpts);

            const row = await db
                .selectFrom(NOORM_TABLES.lock)
                .selectAll()
                .where('config_name', '=', 'dev')
                .executeTakeFirst();

            expect(row).toBeDefined();
            expect(row!.locked_by).toBe('alice@example.com');
            expect(row!.config_name).toBe('dev');

        });

        it('should store optional reason', async () => {

            const manager = getLockManager();

            const lock = await manager.acquire(db, 'dev', 'alice@example.com', {
                ...sqliteOpts,
                reason: 'Running migrations',
            });

            expect(lock.reason).toBe('Running migrations');

            const row = await db
                .selectFrom(NOORM_TABLES.lock)
                .selectAll()
                .where('config_name', '=', 'dev')
                .executeTakeFirst();

            expect(row!.reason).toBe('Running migrations');

        });

        it('should use custom timeout', async () => {

            const manager = getLockManager();

            const lock = await manager.acquire(db, 'dev', 'alice@example.com', {
                ...sqliteOpts,
                timeout: 60_000, // 1 minute
            });

            const expectedExpiry = lock.lockedAt.getTime() + 60_000;
            expect(lock.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -2); // within ~100ms

        });

        it('should throw LockAcquireError when lock is held', async () => {

            const manager = getLockManager();

            // Alice acquires the lock
            await manager.acquire(db, 'dev', 'alice@example.com', sqliteOpts);

            // Bob tries to acquire
            await expect(manager.acquire(db, 'dev', 'bob@example.com', sqliteOpts)).rejects.toThrow(
                LockAcquireError,
            );

        });

        it('should extend lock if same identity re-acquires', async () => {

            const manager = getLockManager();

            const lock1 = await manager.acquire(db, 'dev', 'alice@example.com', sqliteOpts);

            // Small delay to ensure time difference
            await sleep(50);

            const lock2 = await manager.acquire(db, 'dev', 'alice@example.com', sqliteOpts);

            expect(lock2.lockedBy).toBe('alice@example.com');
            expect(lock2.expiresAt.getTime()).toBeGreaterThan(lock1.expiresAt.getTime());

        });

        it('should acquire after expired lock is cleaned up', async () => {

            const manager = getLockManager();

            // Alice acquires with very short timeout
            await manager.acquire(db, 'dev', 'alice@example.com', {
                ...sqliteOpts,
                timeout: 1, // 1ms
            });

            // Wait for expiry
            await sleep(50);

            // Bob should now be able to acquire
            const lock = await manager.acquire(db, 'dev', 'bob@example.com', sqliteOpts);

            expect(lock.lockedBy).toBe('bob@example.com');

        });

        it('should support separate locks per config', async () => {

            const manager = getLockManager();

            const lock1 = await manager.acquire(db, 'dev', 'alice@example.com', sqliteOpts);
            const lock2 = await manager.acquire(db, 'staging', 'bob@example.com', sqliteOpts);

            expect(lock1.lockedBy).toBe('alice@example.com');
            expect(lock2.lockedBy).toBe('bob@example.com');

        });

    });

    describe('acquire with wait', () => {

        it('should wait and acquire when lock is released', async () => {

            const manager = getLockManager();

            // Alice acquires with short timeout
            await manager.acquire(db, 'dev', 'alice@example.com', {
                ...sqliteOpts,
                timeout: 100,
            });

            // Bob waits for lock
            const lockPromise = manager.acquire(db, 'dev', 'bob@example.com', {
                ...sqliteOpts,
                wait: true,
                waitTimeout: 5000,
                pollInterval: 50,
            });

            const lock = await lockPromise;

            expect(lock.lockedBy).toBe('bob@example.com');

        });

        it('should throw after waitTimeout exceeded', async () => {

            const manager = getLockManager();

            // Alice acquires with long timeout
            await manager.acquire(db, 'dev', 'alice@example.com', {
                ...sqliteOpts,
                timeout: 60_000,
            });

            // Bob waits with short timeout
            await expect(
                manager.acquire(db, 'dev', 'bob@example.com', {
                    ...sqliteOpts,
                    wait: true,
                    waitTimeout: 100,
                    pollInterval: 25,
                }),
            ).rejects.toThrow(LockAcquireError);

        });

    });

    describe('release', () => {

        it('should release a lock successfully', async () => {

            const manager = getLockManager();

            await manager.acquire(db, 'dev', 'alice@example.com', sqliteOpts);
            await manager.release(db, 'dev', 'alice@example.com');

            const row = await db
                .selectFrom(NOORM_TABLES.lock)
                .selectAll()
                .where('config_name', '=', 'dev')
                .executeTakeFirst();

            expect(row).toBeUndefined();

        });

        it('should throw LockNotFoundError when no lock exists', async () => {

            const manager = getLockManager();

            await expect(manager.release(db, 'dev', 'alice@example.com')).rejects.toThrow(
                LockNotFoundError,
            );

        });

        it('should throw LockOwnershipError when releasing others lock', async () => {

            const manager = getLockManager();

            await manager.acquire(db, 'dev', 'alice@example.com', sqliteOpts);

            await expect(manager.release(db, 'dev', 'bob@example.com')).rejects.toThrow(
                LockOwnershipError,
            );

        });

    });

    describe('forceRelease', () => {

        it('should release any lock regardless of owner', async () => {

            const manager = getLockManager();

            await manager.acquire(db, 'dev', 'alice@example.com', sqliteOpts);

            const released = await manager.forceRelease(db, 'dev');

            expect(released).toBe(true);

            const row = await db
                .selectFrom(NOORM_TABLES.lock)
                .selectAll()
                .where('config_name', '=', 'dev')
                .executeTakeFirst();

            expect(row).toBeUndefined();

        });

        it('should return false when no lock exists', async () => {

            const manager = getLockManager();

            const released = await manager.forceRelease(db, 'dev');

            expect(released).toBe(false);

        });

    });

    describe('withLock', () => {

        it('should execute operation while holding lock', async () => {

            const manager = getLockManager();
            let executed = false;

            await manager.withLock(db, 'dev', 'alice@example.com', async () => {

                executed = true;

                // Verify lock is held
                const row = await db
                    .selectFrom(NOORM_TABLES.lock)
                    .selectAll()
                    .where('config_name', '=', 'dev')
                    .executeTakeFirst();

                expect(row).toBeDefined();
                expect(row!.locked_by).toBe('alice@example.com');

            }, sqliteOpts);

            expect(executed).toBe(true);

        });

        it('should release lock after operation completes', async () => {

            const manager = getLockManager();

            await manager.withLock(db, 'dev', 'alice@example.com', async () => {
                // do nothing
            }, sqliteOpts);

            const row = await db
                .selectFrom(NOORM_TABLES.lock)
                .selectAll()
                .where('config_name', '=', 'dev')
                .executeTakeFirst();

            expect(row).toBeUndefined();

        });

        it('should release lock even if operation throws', async () => {

            const manager = getLockManager();

            await expect(
                manager.withLock(db, 'dev', 'alice@example.com', async () => {

                    throw new Error('Operation failed');

                }, sqliteOpts),
            ).rejects.toThrow('Operation failed');

            const row = await db
                .selectFrom(NOORM_TABLES.lock)
                .selectAll()
                .where('config_name', '=', 'dev')
                .executeTakeFirst();

            expect(row).toBeUndefined();

        });

        it('should return operation result', async () => {

            const manager = getLockManager();

            const result = await manager.withLock(db, 'dev', 'alice@example.com', async () => {

                return { success: true, count: 42 };

            }, sqliteOpts);

            expect(result).toEqual({ success: true, count: 42 });

        });

    });

    describe('validate', () => {

        it('should succeed when lock is valid', async () => {

            const manager = getLockManager();

            await manager.acquire(db, 'dev', 'alice@example.com', sqliteOpts);

            await expect(manager.validate(db, 'dev', 'alice@example.com', 'sqlite')).resolves.toBeUndefined();

        });

        it('should throw LockNotFoundError when no lock exists', async () => {

            const manager = getLockManager();

            await expect(manager.validate(db, 'dev', 'alice@example.com')).rejects.toThrow(
                LockNotFoundError,
            );

        });

        it('should throw LockOwnershipError when lock held by another', async () => {

            const manager = getLockManager();

            await manager.acquire(db, 'dev', 'alice@example.com', sqliteOpts);

            await expect(manager.validate(db, 'dev', 'bob@example.com', 'sqlite')).rejects.toThrow(
                LockOwnershipError,
            );

        });

        it('should throw LockExpiredError when lock has expired', async () => {

            const manager = getLockManager();

            // Acquire with very short timeout
            await manager.acquire(db, 'dev', 'alice@example.com', {
                ...sqliteOpts,
                timeout: 1,
            });

            // Wait for expiry
            await sleep(50);

            await expect(manager.validate(db, 'dev', 'alice@example.com', 'sqlite')).rejects.toThrow(
                LockExpiredError,
            );

        });

    });

    describe('extend', () => {

        it('should extend lock expiration', async () => {

            const manager = getLockManager();

            const lock1 = await manager.acquire(db, 'dev', 'alice@example.com', {
                ...sqliteOpts,
                timeout: 60_000,
            });

            await sleep(50);

            const lock2 = await manager.extend(db, 'dev', 'alice@example.com', {
                ...sqliteOpts,
                timeout: 120_000,
            });

            expect(lock2.expiresAt.getTime()).toBeGreaterThan(lock1.expiresAt.getTime());

        });

        it('should fail if lock does not exist', async () => {

            const manager = getLockManager();

            await expect(manager.extend(db, 'dev', 'alice@example.com', sqliteOpts)).rejects.toThrow(
                LockNotFoundError,
            );

        });

        it('should fail if lock is held by another', async () => {

            const manager = getLockManager();

            await manager.acquire(db, 'dev', 'alice@example.com', sqliteOpts);

            await expect(manager.extend(db, 'dev', 'bob@example.com', sqliteOpts)).rejects.toThrow(
                LockOwnershipError,
            );

        });

    });

    describe('status', () => {

        it('should return isLocked=false when no lock', async () => {

            const manager = getLockManager();

            const status = await manager.status(db, 'dev', 'sqlite');

            expect(status.isLocked).toBe(false);
            expect(status.lock).toBeNull();

        });

        it('should return lock details when locked', async () => {

            const manager = getLockManager();

            await manager.acquire(db, 'dev', 'alice@example.com', {
                ...sqliteOpts,
                reason: 'Testing',
            });

            const status = await manager.status(db, 'dev', 'sqlite');

            expect(status.isLocked).toBe(true);
            expect(status.lock).not.toBeNull();
            expect(status.lock!.lockedBy).toBe('alice@example.com');
            expect(status.lock!.reason).toBe('Testing');

        });

        it('should clean up expired locks', async () => {

            const manager = getLockManager();

            await manager.acquire(db, 'dev', 'alice@example.com', {
                ...sqliteOpts,
                timeout: 1,
            });

            await sleep(50);

            const status = await manager.status(db, 'dev', 'sqlite');

            expect(status.isLocked).toBe(false);
            expect(status.lock).toBeNull();

        });

    });

});

function sleep(ms: number): Promise<void> {

    return new Promise((resolve) => setTimeout(resolve, ms));

}
