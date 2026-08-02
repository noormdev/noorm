# Lock


## The Problem

Databases don't handle concurrent DDL operations well. When Alice runs changes from her laptop while the CI pipeline runs the same changes, you get race conditions:

- Partial changes leave tables in inconsistent states
- Tracking tables record conflicting information
- Schema changes apply out of order

noorm solves this with table-based locking. Before any operation touches the database, it acquires a lock. Other processes wait or fail fast.


## How It Works

All locking happens through a single table: `__noorm_lock__` on MySQL and SQLite, or `noorm.lock` in the dedicated schema on PostgreSQL and SQL Server. Each config gets its own lock scope - two developers can work on different configs simultaneously, but not the same one.

```
__noorm_lock__
├── id            # Auto-increment primary key
├── config_name   # Which config/database this lock protects — UNIQUE
├── locked_by     # Identity of the holder
├── locked_at     # When acquired
├── expires_at    # Auto-expiry time
└── reason        # Explanation, NOT NULL, defaults to ''
```

The `UNIQUE` constraint on `config_name` is what makes acquisition safe: `acquire` claims the lock with a single `INSERT ... ON CONFLICT DO NOTHING` (`INSERT IGNORE` on MySQL, a plain insert arbitrated by the constraint on MSSQL, which has no `ON CONFLICT`). A `SELECT`-then-`INSERT` would leave a window where two processes both see "no lock" and both insert. Losing the race returns `null` internally and becomes a typed `LockAcquireError`, not a raw driver error.

`locked_at` and `expires_at` are naive datetime columns — no stored offset. `manager.ts` serializes UTC and parses back as UTC per dialect (`formatDateForDialect` / `parseDateFromDialect`, `src/core/lock/manager.ts:68` and `:96`). Passing a JS `Date` straight through is the defect those functions exist to prevent: the postgres and mysql drivers bind using the *client's* local offset, so a `lock status` run from another timezone would compare two unrelated wall clocks and delete a live lock.

Locks expire automatically. If a process crashes mid-operation, the next acquire attempt cleans up the stale lock after expiry. No manual intervention needed.


## Basic Usage

The simplest approach is `withLock` - it acquires, runs your operation, and releases automatically:

```typescript
import { getLockManager, LockManager, resetLockManager } from './core/lock'
import { createConnection } from './core/connection'

// Get the singleton lock manager instance
const lockManager = getLockManager()

// Or create your own instance
const customManager = new LockManager()

// Reset the singleton (useful for testing)
resetLockManager()

const { db } = await createConnection(config.connection, config.name)

await lockManager.withLock(db, 'production', 'alice@example.com', async () => {

    // Your exclusive operation here
    await applyChanges(db)
})
// Lock automatically released, even if applyChanges() throws
```


## Manual Lock Control

When you need finer control, use `acquire` and `release` directly:

```typescript
const lock = await lockManager.acquire(db, 'production', 'alice@example.com', {
    timeout: 10 * 60 * 1000,  // 10 minutes
    reason: 'Running full schema rebuild',
})

console.log(`Lock acquired, expires at ${lock.expiresAt}`)

try {

    await rebuildSchema(db)
    await applyChanges(db)
    await seedData(db)
}
finally {

    // `release` takes the dialect explicitly — it has no default, because it
    // resolves the schema-qualified vs prefixed table name from it.
    await lockManager.release(db, 'production', 'alice@example.com', 'postgres')
}
```


## Lock Options

Configure lock behavior with these options:

| Option | Default | Description |
|--------|---------|-------------|
| `dialect` | `'postgres'` | Resolves the lock table name and the datetime serialization |
| `timeout` | 5 minutes | Lock duration before auto-expiry |
| `wait` | `false` | Block until lock is available? |
| `waitTimeout` | 30 seconds | Max time to wait (if `wait` is true) |
| `pollInterval` | 1 second | Check frequency while waiting |
| `reason` | none | Shown to blocked users |

`dialect` defaults to `'postgres'` on every option-taking method (`acquire`, `withLock`, `extend`, `validate`, `status`). Against MySQL or SQLite you must pass it, or the manager looks for `noorm.lock` in a schema those dialects don't have.

```typescript
// Fail immediately if locked
await lockManager.acquire(db, configName, identity)

// Wait up to 2 minutes for lock
await lockManager.acquire(db, configName, identity, {
    wait: true,
    waitTimeout: 2 * 60 * 1000,
    pollInterval: 500,
})

// Long-running operation
await lockManager.acquire(db, configName, identity, {
    timeout: 30 * 60 * 1000,  // 30 minutes
    reason: 'Full database rebuild',
})
```


## Checking Lock Status

Before starting work, check if someone else has the lock. Note that `status()` automatically cleans up expired locks before checking:

```typescript
const status = await lockManager.status(db, 'production')

if (status.isLocked) {

    console.log(`Database locked by ${status.lock.lockedBy}`)
    console.log(`Since: ${status.lock.lockedAt}`)
    console.log(`Expires: ${status.lock.expiresAt}`)

    if (status.lock.reason) {

        console.log(`Reason: ${status.lock.reason}`)
    }
}
else {

    console.log('Database is available')
}
```


## Extending Locks

Long operations might outlast the initial timeout. Use the `extend()` method before expiry:

```typescript
const lock = await lockManager.acquire(db, configName, identity, {
    timeout: 5 * 60 * 1000,  // 5 minutes
})

// After processing half the files...
// extend() is a dedicated public API method (default timeout: 5 minutes)
await lockManager.extend(db, configName, identity, {
    timeout: 10 * 60 * 1000,  // Another 10 minutes
})
```

Note: Re-acquiring a lock you already hold also extends it (see "Re-acquiring Your Lock" below).


## Validating Locks

Before committing critical changes, verify your lock is still valid:

```typescript
import { attempt } from '@logosdx/utils'
import { LockExpiredError } from './core/lock'

// Start a transaction
await db.transaction().execute(async (trx) => {

    await processChanges(trx)

    // Before committing, verify lock hasn't expired
    const [, err] = await attempt(() =>
        lockManager.validate(db, configName, identity, 'postgres')
    )

    if (err instanceof LockExpiredError) {

        // Lock expired! Roll back
        throw new Error('Lock expired during operation')
    }

    if (err) throw err

    // Lock is valid, safe to commit
})
```

`validate` also throws `LockNotFoundError` when no row exists and `LockOwnershipError` when someone else holds it. On expiry it cleans the stale row up before throwing.


## Force Release

Admins can force-release locks regardless of owner. Use sparingly:

```typescript
// Returns { released, holder } — `holder` is null when there was nothing to release
const { released, holder } = await lockManager.forceRelease(db, 'production', 'postgres')

if (released) {

    console.log(`Forced release of lock held by ${holder}`)
}
```

`forceRelease` returns a `ForceReleaseResult`, not a boolean, and it carries the evicted holder. Breaking someone else's lock is destructive to their in-flight work, so callers need to be able to say *whose* lock they broke — and to tell "evicted a live holder" apart from "there was nothing there", which a bare boolean collapsed into the same success.

This is intended for CLI commands like `noorm lock force-release` when a crashed process left a lock behind.

**Note**: `forceRelease` emits a `lock:released` event when successful.


## Error Handling

Lock operations throw specific errors you can handle:

```typescript
import { attempt } from '@logosdx/utils'
import {
    LockAcquireError,
    LockExpiredError,
    LockNotFoundError,
    LockOwnershipError,
} from './core/lock'

const [lock, err] = await attempt(() =>
    lockManager.acquire(db, configName, identity)
)

if (err instanceof LockAcquireError) {

    console.log(`Blocked by ${err.holder} since ${err.heldSince}`)
    console.log(`Expires at ${err.expiresAt}`)

    if (err.reason) {

        console.log(`They're doing: ${err.reason}`)
    }
}
else if (err instanceof LockExpiredError) {

    console.log(`Your lock expired at ${err.expiredAt}`)
}
else if (err instanceof LockNotFoundError) {

    console.log('No lock to release')
}
else if (err instanceof LockOwnershipError) {

    console.log(`Lock held by ${err.actualHolder}, not you`)
}
```

| Error | When Thrown |
|-------|-------------|
| `LockAcquireError` | Lock held by another, wait timed out |
| `LockExpiredError` | Your lock expired during operation |
| `LockNotFoundError` | Tried to release non-existent lock |
| `LockOwnershipError` | Tried to release someone else's lock |


## Multiple Configs

Each config has independent lock scope. Work on different databases in parallel:

```typescript
// These can run simultaneously
await Promise.all([
    lockManager.withLock(db, 'dev', identity, () => applyChanges('dev')),
    lockManager.withLock(db, 'staging', identity, () => applyChanges('staging')),
])

// But this would block - same config
await lockManager.acquire(db, 'production', 'alice')
await lockManager.acquire(db, 'production', 'bob')  // Throws LockAcquireError
```


## Re-acquiring Your Lock

If you already hold a lock, acquiring again extends it:

```typescript
// Alice acquires
await lockManager.acquire(db, configName, 'alice@example.com')

// Alice acquires again - extends the lock, doesn't fail
await lockManager.acquire(db, configName, 'alice@example.com')

// Bob tries - fails
await lockManager.acquire(db, configName, 'bob@example.com')  // Throws
```


## Observer Events

Lock operations emit events for CLI feedback:

```typescript
import { observer } from './core/observer'

observer.on('lock:acquiring', ({ configName, identity }) => {

    console.log(`Acquiring lock for ${configName}...`)
})

observer.on('lock:acquired', ({ configName, identity, expiresAt }) => {

    console.log(`Lock acquired, expires ${expiresAt}`)
})

observer.on('lock:blocked', ({ configName, holder, heldSince }) => {

    console.log(`Blocked by ${holder} (since ${heldSince})`)
})

observer.on('lock:released', ({ configName, identity }) => {

    console.log('Lock released')
})

observer.on('lock:expired', ({ configName, previousHolder }) => {

    console.log(`Cleaned up expired lock from ${previousHolder}`)
})
```

| Event | When Emitted |
|-------|--------------|
| `lock:acquiring` | Starting to acquire lock |
| `lock:acquired` | Lock successfully obtained |
| `lock:blocked` | Found lock held by another |
| `lock:released` | Lock released |
| `lock:expired` | Expired lock cleaned up |
