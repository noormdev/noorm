/**
 * Lock-related errors.
 *
 * WHY: Specific error types allow callers to handle lock failures
 * differently from other errors (e.g., prompt user to wait vs retry).
 */


/**
 * Error when lock cannot be acquired.
 *
 * Thrown when another process holds the lock and wait=false,
 * or when waitTimeout is exceeded.
 *
 * @example
 * ```typescript
 * const [lock, err] = await attempt(() => lockManager.acquire(config, identity))
 * if (err instanceof LockAcquireError) {
 *     console.log(`Blocked by ${err.holder} since ${err.heldSince}`)
 * }
 * ```
 */
export class LockAcquireError extends Error {

    override readonly name = 'LockAcquireError' as const

    constructor(
        public readonly configName: string,
        public readonly holder: string,
        public readonly heldSince: Date,
        public readonly expiresAt: Date,
        public readonly reason?: string,
    ) {

        const since = heldSince.toISOString()
        const expires = expiresAt.toISOString()
        const reasonSuffix = reason ? ` (${reason})` : ''

        super(
            `Lock for '${configName}' held by ${holder} since ${since}, expires ${expires}${reasonSuffix}`
        )
    }
}


/**
 * Error when lock expires during operation.
 *
 * Thrown when validating lock before a critical operation
 * and discovering it has expired.
 *
 * @example
 * ```typescript
 * // Before committing transaction
 * const [, err] = await attempt(() => lockManager.validate(configName, identity))
 * if (err instanceof LockExpiredError) {
 *     await transaction.rollback()
 *     throw new Error('Lock expired, operation aborted')
 * }
 * ```
 */
export class LockExpiredError extends Error {

    override readonly name = 'LockExpiredError' as const

    constructor(
        public readonly configName: string,
        public readonly identity: string,
        public readonly expiredAt: Date,
    ) {

        super(
            `Lock for '${configName}' expired at ${expiredAt.toISOString()}`
        )
    }
}


/**
 * Error when trying to release a non-existent lock.
 *
 * Thrown when release() is called but no lock exists,
 * or the lock is held by a different identity.
 *
 * @example
 * ```typescript
 * const [, err] = await attempt(() => lockManager.release(configName, identity))
 * if (err instanceof LockNotFoundError) {
 *     // Lock was already released or expired
 * }
 * ```
 */
export class LockNotFoundError extends Error {

    override readonly name = 'LockNotFoundError' as const

    constructor(
        public readonly configName: string,
        public readonly identity: string,
    ) {

        super(
            `No lock found for '${configName}' held by ${identity}`
        )
    }
}


/**
 * Error when trying to release a lock held by someone else.
 *
 * @example
 * ```typescript
 * const [, err] = await attempt(() => lockManager.release(configName, identity))
 * if (err instanceof LockOwnershipError) {
 *     console.log(`Lock held by ${err.actualHolder}, not ${err.requestedBy}`)
 * }
 * ```
 */
export class LockOwnershipError extends Error {

    override readonly name = 'LockOwnershipError' as const

    constructor(
        public readonly configName: string,
        public readonly requestedBy: string,
        public readonly actualHolder: string,
    ) {

        super(
            `Cannot release lock for '${configName}': held by ${actualHolder}, not ${requestedBy}`
        )
    }
}
