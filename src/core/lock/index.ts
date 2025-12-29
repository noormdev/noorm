/**
 * Lock module exports.
 *
 * Provides concurrent operation protection for database operations.
 *
 * @example
 * ```typescript
 * import {
 *     getLockManager,
 *     LockAcquireError,
 *     type Lock,
 *     type LockOptions,
 * } from './lock'
 *
 * const lockManager = getLockManager()
 *
 * // Use withLock for automatic cleanup
 * await lockManager.withLock(db, 'dev', 'alice@example.com', async () => {
 *     await runMigrations()
 * })
 *
 * // Or handle errors manually
 * const [lock, err] = await attempt(() =>
 *     lockManager.acquire(db, 'dev', 'alice@example.com')
 * )
 * if (err instanceof LockAcquireError) {
 *     console.log(`Blocked by ${err.holder}`)
 * }
 * ```
 */

// Types
export type { Lock, LockOptions, LockStatus } from './types.js';

export { DEFAULT_LOCK_OPTIONS } from './types.js';

// Errors
export {
    LockAcquireError,
    LockExpiredError,
    LockNotFoundError,
    LockOwnershipError,
} from './errors.js';

// Manager
export { LockManager, getLockManager, resetLockManager } from './manager.js';
