/**
 * Lock namespace — database lock management.
 *
 * Mirrors [l] lock in the TUI. All operations require a connection.
 */
import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../core/shared/index.js';
import type { ForceReleaseResult, Lock, LockStatus, LockOptions } from '../../core/lock/index.js';
import { getLockManager } from '../../core/lock/index.js';
import { formatIdentity } from '../../core/identity/index.js';

import type { ContextState } from '../state.js';
import { ensureTracking, requireConnection } from '../state.js';
import { checkConfigPolicy, isVisibleToChannel } from '../../core/policy/index.js';
import { readerRemedy, requireCurrentSchema } from '../../core/version/index.js';
import { checkProtectedConfig, ProtectedConfigError } from '../guards.js';

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
     * `acquire`, `withLock` and `release` are gated by the config's `lock:acquire` access: they write
     * to the database, and the check runs first so a refused caller creates no tracking tables.
     *
     * @example
     * ```typescript
     * const lock = await ctx.noorm.lock.acquire({ timeout: 60000 })
     * ```
     */
    async acquire(options?: LockOptions): Promise<Lock> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'lock:acquire', 'lock.acquire');

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#state.identity);

        await ensureTracking(this.#state);

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

        checkProtectedConfig(this.#state.config, this.#state.options, 'lock:acquire', 'lock.release');

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
     * A read: it clears an expired lock only for a caller that may acquire one, and
     * refuses a config hidden from the channel.
     *
     * @example
     * ```typescript
     * const status = await ctx.noorm.lock.status()
     * ```
     */
    async status(): Promise<LockStatus> {

        const { config, options } = this.#state;
        const channel = options.channel ?? 'user';
        const mayAcquire = checkConfigPolicy(channel, config, 'lock:acquire');

        if (!isVisibleToChannel(config.access, channel)) {

            throw new ProtectedConfigError(config.name, 'lock.status', mayAcquire.blockedReason);

        }

        const db = this.#kysely as unknown as Kysely<NoormDatabase>;
        const { dialect } = config.connection;

        await requireCurrentSchema(db, dialect, readerRemedy('lock status'));

        return getLockManager().status(db, config.name, dialect, { removeExpired: mayAcquire.allowed });

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

        checkProtectedConfig(this.#state.config, this.#state.options, 'lock:acquire', 'lock.withLock');

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#state.identity);

        await ensureTracking(this.#state);

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
     * Gated by the config's `lock:force` access: breaking someone else's lock
     * interrupts their in-flight migration, so `viewer` is denied outright and
     * `operator`/`admin` must pre-confirm. Gating here rather than in each
     * command means CLI, TUI and MCP inherit one enforcement path.
     *
     * @returns whether a lock was released, and who held it
     *
     * @example
     * ```typescript
     * const { released, holder } = await ctx.noorm.lock.forceRelease()
     * ```
     */
    async forceRelease(): Promise<ForceReleaseResult> {

        checkProtectedConfig(
            this.#state.config,
            this.#state.options,
            'lock:force',
            'lock.forceRelease',
        );

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
