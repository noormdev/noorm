/**
 * Lock namespace — database lock management.
 *
 * Mirrors [l] lock in the TUI. All operations require a connection.
 */
import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../core/shared/index.js';
import type { Lock, LockStatus, LockOptions } from '../../core/lock/index.js';
import { getLockManager } from '../../core/lock/index.js';
import { formatIdentity } from '../../core/identity/index.js';

import type { ContextState } from '../state.js';
import { requireConnection } from '../state.js';

// ─────────────────────────────────────────────────────────────
// LockNamespace
// ─────────────────────────────────────────────────────────────

export class LockNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    /**
     * Acquire a database lock.
     *
     * @example
     * ```typescript
     * const lock = await ctx.noorm.lock.acquire({ timeout: 60000 })
     * ```
     */
    async acquire(options?: LockOptions): Promise<Lock> {

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#state.identity);

        return lockManager.acquire(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            identityStr,
            { ...options, dialect: this.#state.config.connection.dialect },
        );

    }

    /**
     * Release the current lock.
     *
     * @example
     * ```typescript
     * await ctx.noorm.lock.release()
     * ```
     */
    async release(): Promise<void> {

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#state.identity);

        await lockManager.release(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            identityStr,
            this.#state.config.connection.dialect,
        );

    }

    /**
     * Get current lock status.
     *
     * @example
     * ```typescript
     * const status = await ctx.noorm.lock.status()
     * ```
     */
    async status(): Promise<LockStatus> {

        const lockManager = getLockManager();

        return lockManager.status(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            this.#state.config.connection.dialect,
        );

    }

    /**
     * Execute an operation with automatic lock acquisition and release.
     *
     * @example
     * ```typescript
     * await ctx.noorm.lock.withLock(async () => {
     *     await ctx.noorm.run.build()
     * })
     * ```
     */
    async withLock<T>(fn: () => Promise<T>, options?: LockOptions): Promise<T> {

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#state.identity);

        return lockManager.withLock(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            identityStr,
            fn,
            { ...options, dialect: this.#state.config.connection.dialect },
        );

    }

    /**
     * Force release any database lock regardless of ownership.
     *
     * @example
     * ```typescript
     * await ctx.noorm.lock.forceRelease()
     * ```
     */
    async forceRelease(): Promise<boolean> {

        const lockManager = getLockManager();

        return lockManager.forceRelease(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            this.#state.config.connection.dialect,
        );

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #kysely(): Kysely<unknown> {

        return requireConnection(this.#state).db;

    }

}
