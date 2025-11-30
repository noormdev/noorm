# Lock Manager


## Overview

The lock manager prevents concurrent noorm operations on the same database. This is critical when:

- Multiple developers run changesets simultaneously
- CI/CD pipelines overlap with manual operations
- Multiple instances of the same deployment run

Two strategies are supported:

1. **Advisory locks** (Postgres) - Database-level, no table needed
2. **Lock table** (Cross-dialect) - Uses `__noorm_lock__` table


## Dependencies

```json
{
    "@logosdx/observer": "^x.x.x",
    "@logosdx/utils": "^x.x.x"
}
```


## File Structure

```
src/core/
├── lock/
│   ├── index.ts           # Public exports
│   ├── manager.ts         # LockManager class
│   ├── types.ts           # Lock interfaces
│   ├── strategies/
│   │   ├── advisory.ts    # Postgres advisory locks
│   │   └── table.ts       # Table-based locks
│   └── errors.ts          # Lock-specific errors
```


## Types

```typescript
// src/core/lock/types.ts

import { Identity } from '../identity/types';

export interface Lock {
    id: string;
    lockedBy: string;
    lockedAt: Date;
    expiresAt: Date;
    identity: Identity;
}

export interface LockOptions {
    /** Lock timeout in milliseconds (default: 10 minutes) */
    timeout?: number;

    /** Wait for lock to be released (default: false) */
    wait?: boolean;

    /** Max time to wait for lock in milliseconds (default: 30 seconds) */
    waitTimeout?: number;

    /** Poll interval when waiting (default: 1 second) */
    pollInterval?: number;
}

export interface LockStrategy {
    acquire(identity: Identity, options: LockOptions): Promise<Lock | null>;
    release(lock: Lock): Promise<void>;
    forceRelease(): Promise<void>;
    getStatus(): Promise<Lock | null>;
    isExpired(lock: Lock): boolean;
}

export const DEFAULT_LOCK_OPTIONS: Required<LockOptions> = {
    timeout: 10 * 60 * 1000,      // 10 minutes
    wait: false,
    waitTimeout: 30 * 1000,       // 30 seconds
    pollInterval: 1000,           // 1 second
};
```


## Errors

```typescript
// src/core/lock/errors.ts

import { Lock } from './types';

export class LockError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LockError';
    }
}

export class LockAcquireError extends LockError {
    constructor(
        public existingLock: Lock,
        message?: string
    ) {
        super(
            message ??
            `Database is locked by ${existingLock.lockedBy} since ${existingLock.lockedAt.toISOString()}. ` +
            `Lock expires at ${existingLock.expiresAt.toISOString()}.`
        );
        this.name = 'LockAcquireError';
    }
}

export class LockExpiredError extends LockError {
    constructor() {
        super('Lock has expired. Another operation may have taken over.');
        this.name = 'LockExpiredError';
    }
}

export class LockNotFoundError extends LockError {
    constructor() {
        super('No lock found to release.');
        this.name = 'LockNotFoundError';
    }
}
```


## Advisory Lock Strategy (Postgres)

Uses PostgreSQL's advisory locks for efficient, automatic cleanup.

```typescript
// src/core/lock/strategies/advisory.ts

import { Kysely, sql } from 'kysely';
import { Identity, identityToString } from '../../identity';
import { Lock, LockOptions, LockStrategy, DEFAULT_LOCK_OPTIONS } from '../types';
import { LockAcquireError } from '../errors';

// Consistent lock key derived from 'noorm'
const LOCK_KEY = 0x6e6f6f726d; // 'noorm' in hex

export class AdvisoryLockStrategy implements LockStrategy {
    private currentLock: Lock | null = null;

    constructor(private db: Kysely<any>) {}

    async acquire(identity: Identity, options: LockOptions = {}): Promise<Lock | null> {
        const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };

        // Try to acquire advisory lock (non-blocking)
        const result = await sql<{ acquired: boolean }>`
            SELECT pg_try_advisory_lock(${LOCK_KEY}) as acquired
        `.execute(this.db);

        const acquired = result.rows[0]?.acquired;

        if (!acquired) {
            // Check who has it
            const existing = await this.getStatus();
            if (existing && !this.isExpired(existing)) {
                if (opts.wait) {
                    return this.waitForLock(identity, opts);
                }
                throw new LockAcquireError(existing);
            }

            // Lock exists but expired, force release and retry
            await this.forceRelease();
            return this.acquire(identity, { ...options, wait: false });
        }

        // Create lock record
        const now = new Date();
        this.currentLock = {
            id: `advisory-${LOCK_KEY}`,
            lockedBy: identityToString(identity),
            lockedAt: now,
            expiresAt: new Date(now.getTime() + opts.timeout),
            identity,
        };

        // Store lock metadata in a table for status queries
        await this.storeLockMetadata(this.currentLock);

        return this.currentLock;
    }

    async release(lock: Lock): Promise<void> {
        await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`.execute(this.db);
        await this.clearLockMetadata();
        this.currentLock = null;
    }

    async forceRelease(): Promise<void> {
        // Force unlock all sessions holding this lock
        await sql`SELECT pg_advisory_unlock_all()`.execute(this.db);
        await this.clearLockMetadata();
        this.currentLock = null;
    }

    async getStatus(): Promise<Lock | null> {
        try {
            const result = await sql<{
                locked_by: string;
                locked_at: Date;
                expires_at: Date;
            }>`
                SELECT locked_by, locked_at, expires_at
                FROM __noorm_lock__
                WHERE id = 1
            `.execute(this.db);

            if (result.rows.length === 0) return null;

            const row = result.rows[0];
            return {
                id: `advisory-${LOCK_KEY}`,
                lockedBy: row.locked_by,
                lockedAt: new Date(row.locked_at),
                expiresAt: new Date(row.expires_at),
                identity: { name: row.locked_by, source: 'system' },
            };
        } catch {
            // Table doesn't exist yet
            return null;
        }
    }

    isExpired(lock: Lock): boolean {
        return new Date() > lock.expiresAt;
    }

    private async waitForLock(identity: Identity, opts: Required<LockOptions>): Promise<Lock | null> {
        const deadline = Date.now() + opts.waitTimeout;

        while (Date.now() < deadline) {
            await sleep(opts.pollInterval);

            const status = await this.getStatus();
            if (!status || this.isExpired(status)) {
                return this.acquire(identity, { ...opts, wait: false });
            }
        }

        const existing = await this.getStatus();
        if (existing) {
            throw new LockAcquireError(existing, 'Timed out waiting for lock.');
        }

        return this.acquire(identity, { ...opts, wait: false });
    }

    private async storeLockMetadata(lock: Lock): Promise<void> {
        await sql`
            INSERT INTO __noorm_lock__ (id, locked_by, locked_at, expires_at)
            VALUES (1, ${lock.lockedBy}, ${lock.lockedAt}, ${lock.expiresAt})
            ON CONFLICT (id) DO UPDATE SET
                locked_by = EXCLUDED.locked_by,
                locked_at = EXCLUDED.locked_at,
                expires_at = EXCLUDED.expires_at
        `.execute(this.db);
    }

    private async clearLockMetadata(): Promise<void> {
        await sql`DELETE FROM __noorm_lock__ WHERE id = 1`.execute(this.db);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```


## Table Lock Strategy (Cross-Dialect)

Works with any database using a lock table.

```typescript
// src/core/lock/strategies/table.ts

import { Kysely, sql } from 'kysely';
import { Identity, identityToString } from '../../identity';
import { Lock, LockOptions, LockStrategy, DEFAULT_LOCK_OPTIONS } from '../types';
import { LockAcquireError, LockNotFoundError } from '../errors';

export class TableLockStrategy implements LockStrategy {
    constructor(private db: Kysely<any>) {}

    async acquire(identity: Identity, options: LockOptions = {}): Promise<Lock | null> {
        const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
        const now = new Date();
        const expiresAt = new Date(now.getTime() + opts.timeout);
        const lockedBy = identityToString(identity);

        // Try to insert or update if expired
        try {
            // First, try to clean up expired locks
            await this.db
                .deleteFrom('__noorm_lock__')
                .where('expires_at', '<', now)
                .execute();

            // Try to insert new lock
            await this.db
                .insertInto('__noorm_lock__')
                .values({
                    id: 1,
                    locked_by: lockedBy,
                    locked_at: now,
                    expires_at: expiresAt,
                })
                .execute();

            return {
                id: 'table-1',
                lockedBy,
                lockedAt: now,
                expiresAt,
                identity,
            };
        } catch (error) {
            // Insert failed, check existing lock
            const existing = await this.getStatus();

            if (!existing) {
                // Race condition, retry
                return this.acquire(identity, options);
            }

            if (this.isExpired(existing)) {
                // Expired, force release and retry
                await this.forceRelease();
                return this.acquire(identity, options);
            }

            if (opts.wait) {
                return this.waitForLock(identity, opts);
            }

            throw new LockAcquireError(existing);
        }
    }

    async release(lock: Lock): Promise<void> {
        const result = await this.db
            .deleteFrom('__noorm_lock__')
            .where('id', '=', 1)
            .where('locked_by', '=', lock.lockedBy)
            .executeTakeFirst();

        if (result.numDeletedRows === BigInt(0)) {
            throw new LockNotFoundError();
        }
    }

    async forceRelease(): Promise<void> {
        await this.db
            .deleteFrom('__noorm_lock__')
            .where('id', '=', 1)
            .execute();
    }

    async getStatus(): Promise<Lock | null> {
        try {
            const result = await this.db
                .selectFrom('__noorm_lock__')
                .selectAll()
                .where('id', '=', 1)
                .executeTakeFirst();

            if (!result) return null;

            return {
                id: 'table-1',
                lockedBy: result.locked_by,
                lockedAt: new Date(result.locked_at),
                expiresAt: new Date(result.expires_at),
                identity: { name: result.locked_by, source: 'system' },
            };
        } catch {
            // Table doesn't exist
            return null;
        }
    }

    isExpired(lock: Lock): boolean {
        return new Date() > lock.expiresAt;
    }

    private async waitForLock(identity: Identity, opts: Required<LockOptions>): Promise<Lock | null> {
        const deadline = Date.now() + opts.waitTimeout;

        while (Date.now() < deadline) {
            await sleep(opts.pollInterval);

            const status = await this.getStatus();
            if (!status || this.isExpired(status)) {
                return this.acquire(identity, { ...opts, wait: false });
            }
        }

        const existing = await this.getStatus();
        if (existing) {
            throw new LockAcquireError(existing, 'Timed out waiting for lock.');
        }

        return this.acquire(identity, { ...opts, wait: false });
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```


## Lock Manager

High-level interface that selects the appropriate strategy.

```typescript
// src/core/lock/manager.ts

import { Kysely, sql } from 'kysely';
import { retry, attempt } from '@logosdx/utils';
import { Dialect } from '../connection/types';
import { Identity, identityToString } from '../identity';
import { Lock, LockOptions, LockStrategy } from './types';
import { AdvisoryLockStrategy } from './strategies/advisory';
import { TableLockStrategy } from './strategies/table';
import { LockExpiredError, LockAcquireError } from './errors';
import { observer } from '../observer';

export class LockManager {
    private strategy: LockStrategy;
    private currentLock: Lock | null = null;
    private configName: string;

    constructor(
        private db: Kysely<any>,
        private dialect: Dialect,
        configName: string = '__default__'
    ) {
        this.strategy = this.createStrategy();
        this.configName = configName;
    }

    private createStrategy(): LockStrategy {
        // Use advisory locks for Postgres (more efficient)
        if (this.dialect === 'postgres') {
            return new AdvisoryLockStrategy(this.db);
        }

        // Table-based for everything else
        return new TableLockStrategy(this.db);
    }

    /**
     * Ensure lock table exists (call during bootstrap).
     */
    async ensureLockTable(): Promise<void> {
        await sql`
            CREATE TABLE IF NOT EXISTS __noorm_lock__ (
                id INTEGER PRIMARY KEY,
                locked_by VARCHAR(255) NOT NULL,
                locked_at TIMESTAMP NOT NULL,
                expires_at TIMESTAMP NOT NULL
            )
        `.execute(this.db);
    }

    /**
     * Acquire a lock with retry support.
     */
    async acquire(identity: Identity, options?: LockOptions): Promise<Lock> {
        const identityStr = identityToString(identity);
        observer.emit('lock:acquiring', { configName: this.configName, identity: identityStr });

        // Check if someone else has it first
        const existing = await this.getStatus();
        if (existing && !this.strategy.isExpired(existing)) {
            observer.emit('lock:blocked', {
                configName: this.configName,
                holder: existing.lockedBy,
                heldSince: existing.lockedAt
            });

            if (!options?.wait) {
                throw new LockAcquireError(existing);
            }
        }

        // Use retry for lock acquisition with wait
        const acquireWithRetry = options?.wait
            ? retry(
                async () => {
                    const lock = await this.strategy.acquire(identity, { ...options, wait: false });
                    if (!lock) throw new Error('Failed to acquire lock');
                    return lock;
                },
                {
                    retries: Math.ceil((options.waitTimeout ?? 30000) / (options.pollInterval ?? 1000)),
                    delay: options.pollInterval ?? 1000,
                    backoff: 1,  // No backoff, constant polling
                    shouldRetry: () => true
                }
            )
            : () => this.strategy.acquire(identity, options);

        const [lock, err] = await attempt(acquireWithRetry);

        if (err) {
            const status = await this.getStatus();
            if (status) {
                throw new LockAcquireError(status, err.message);
            }
            throw err;
        }

        if (!lock) {
            throw new Error('Failed to acquire lock');
        }

        this.currentLock = lock;
        observer.emit('lock:acquired', {
            configName: this.configName,
            identity: identityStr,
            expiresAt: lock.expiresAt
        });

        return lock;
    }

    /**
     * Release the current lock.
     */
    async release(): Promise<void> {
        if (!this.currentLock) return;

        const identityStr = this.currentLock.lockedBy;
        const [, err] = await attempt(() => this.strategy.release(this.currentLock!));

        if (err) {
            observer.emit('error', { source: 'lock', error: err });
        } else {
            observer.emit('lock:released', { configName: this.configName, identity: identityStr });
        }

        this.currentLock = null;
    }

    /**
     * Force release any existing lock (use with caution).
     */
    async forceRelease(): Promise<void> {
        const existing = await this.getStatus();
        const previousHolder = existing?.lockedBy;

        await this.strategy.forceRelease();
        this.currentLock = null;

        if (previousHolder) {
            observer.emit('lock:released', { configName: this.configName, identity: previousHolder });
        }
    }

    /**
     * Get current lock status.
     */
    async getStatus(): Promise<Lock | null> {
        return this.strategy.getStatus();
    }

    /**
     * Check if current lock is still valid.
     */
    async validateLock(): Promise<void> {
        if (!this.currentLock) return;

        if (this.strategy.isExpired(this.currentLock)) {
            observer.emit('lock:expired', {
                configName: this.configName,
                previousHolder: this.currentLock.lockedBy
            });
            this.currentLock = null;
            throw new LockExpiredError();
        }
    }

    /**
     * Extend the current lock's expiration.
     */
    async extendLock(additionalMs: number): Promise<void> {
        if (!this.currentLock) return;

        const newExpiry = new Date(this.currentLock.expiresAt.getTime() + additionalMs);

        await sql`
            UPDATE __noorm_lock__
            SET expires_at = ${newExpiry}
            WHERE id = 1
        `.execute(this.db);

        this.currentLock.expiresAt = newExpiry;
    }

    /**
     * Execute a function with a lock.
     */
    async withLock<T>(
        identity: Identity,
        fn: () => Promise<T>,
        options?: LockOptions
    ): Promise<T> {
        await this.acquire(identity, options);

        try {
            return await fn();
        } finally {
            await this.release();
        }
    }

    /**
     * Check if we currently hold a lock.
     */
    hasLock(): boolean {
        return this.currentLock !== null && !this.strategy.isExpired(this.currentLock);
    }

    /**
     * Get the current lock (if any).
     */
    getCurrentLock(): Lock | null {
        return this.currentLock;
    }
}
```


## Public Exports

```typescript
// src/core/lock/index.ts

export { LockManager } from './manager';
export * from './types';
export * from './errors';
```


## Usage Examples

### Basic Locking

```typescript
import { LockManager } from './core/lock';
import { resolveIdentity } from './core/identity';
import { createConnection } from './core/connection';

const conn = await createConnection(config.connection);
const lockManager = new LockManager(conn.db, config.connection.dialect);

// Ensure table exists (during app init)
await lockManager.ensureLockTable();

// Acquire lock
const identity = resolveIdentity();
const lock = await lockManager.acquire(identity);

try {
    // Do database operations...
    await runMigrations();
} finally {
    await lockManager.release();
}
```

### Using withLock Helper

```typescript
const result = await lockManager.withLock(identity, async () => {
    // Everything in here is protected by the lock
    await applyChangeset(changeset);
    return { success: true };
});
```

### Waiting for Lock

```typescript
try {
    await lockManager.acquire(identity, {
        wait: true,
        waitTimeout: 60_000,  // Wait up to 60 seconds
    });
} catch (error) {
    if (error instanceof LockAcquireError) {
        console.error(`Database locked by ${error.existingLock.lockedBy}`);
    }
}
```

### Check Lock Status

```typescript
const status = await lockManager.getStatus();

if (status) {
    console.log(`Locked by: ${status.lockedBy}`);
    console.log(`Since: ${status.lockedAt}`);
    console.log(`Expires: ${status.expiresAt}`);

    if (lockManager.isExpired(status)) {
        console.log('Lock has expired');
    }
} else {
    console.log('Database is not locked');
}
```

### Force Release (Admin)

```typescript
// For `noorm lock release` command
const status = await lockManager.getStatus();

if (status) {
    console.log(`Releasing lock held by ${status.lockedBy}`);
    await lockManager.forceRelease();
    console.log('Lock released');
}
```


## Lock Table Schema

```sql
CREATE TABLE __noorm_lock__ (
    id INTEGER PRIMARY KEY,           -- Always 1 (single row)
    locked_by VARCHAR(255) NOT NULL,  -- Identity string
    locked_at TIMESTAMP NOT NULL,     -- When lock was acquired
    expires_at TIMESTAMP NOT NULL     -- Auto-expiry time
);
```


## CLI Commands

### `noorm lock status`

```typescript
const status = await lockManager.getStatus();

if (!status) {
    console.log('No active lock');
    return;
}

const isExpired = new Date() > status.expiresAt;

console.log(`Locked by: ${status.lockedBy}`);
console.log(`Locked at: ${status.lockedAt.toISOString()}`);
console.log(`Expires at: ${status.expiresAt.toISOString()}`);
console.log(`Status: ${isExpired ? 'EXPIRED' : 'ACTIVE'}`);
```

### `noorm lock release`

```typescript
const status = await lockManager.getStatus();

if (!status) {
    console.log('No lock to release');
    return;
}

// Check if protected config
if (config.protected) {
    const confirmed = await confirmAction(
        `Release lock on protected config "${config.name}"?`,
        `yes-${config.name}`
    );
    if (!confirmed) return;
}

await lockManager.forceRelease();
console.log('Lock released');
```


## Testing

```typescript
import { LockManager } from './core/lock';
import { createConnection } from './core/connection';

describe('LockManager', () => {
    let conn: ConnectionResult;
    let lockManager: LockManager;

    beforeEach(async () => {
        conn = await createConnection({
            dialect: 'sqlite',
            database: ':memory:',
        });
        lockManager = new LockManager(conn.db, 'sqlite');
        await lockManager.ensureLockTable();
    });

    afterEach(async () => {
        await conn.destroy();
    });

    const testIdentity = { name: 'test', source: 'config' as const };

    it('should acquire and release lock', async () => {
        const lock = await lockManager.acquire(testIdentity);
        expect(lock).toBeDefined();
        expect(lockManager.hasLock()).toBe(true);

        await lockManager.release();
        expect(lockManager.hasLock()).toBe(false);
    });

    it('should prevent concurrent locks', async () => {
        await lockManager.acquire(testIdentity);

        const manager2 = new LockManager(conn.db, 'sqlite');

        await expect(
            manager2.acquire({ name: 'other', source: 'config' })
        ).rejects.toThrow(LockAcquireError);
    });

    it('should allow lock after expiry', async () => {
        await lockManager.acquire(testIdentity, { timeout: 1 }); // 1ms timeout

        await sleep(10); // Wait for expiry

        const manager2 = new LockManager(conn.db, 'sqlite');
        const lock = await manager2.acquire({ name: 'other', source: 'config' });

        expect(lock).toBeDefined();
    });

    it('should wait for lock if requested', async () => {
        await lockManager.acquire(testIdentity, { timeout: 100 });

        const manager2 = new LockManager(conn.db, 'sqlite');

        const acquirePromise = manager2.acquire(
            { name: 'other', source: 'config' },
            { wait: true, waitTimeout: 500 }
        );

        // Release after 50ms
        setTimeout(() => lockManager.release(), 50);

        const lock = await acquirePromise;
        expect(lock).toBeDefined();
    });

    it('should use withLock helper', async () => {
        let executed = false;

        await lockManager.withLock(testIdentity, async () => {
            expect(lockManager.hasLock()).toBe(true);
            executed = true;
        });

        expect(executed).toBe(true);
        expect(lockManager.hasLock()).toBe(false);
    });
});
```


## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| `LockAcquireError` | Another operation holds the lock | Wait, or check who has it |
| `LockExpiredError` | Lock expired during operation | Re-acquire and retry |
| `LockNotFoundError` | Tried to release non-existent lock | Usually safe to ignore |
