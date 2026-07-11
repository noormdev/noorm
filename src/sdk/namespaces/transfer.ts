/**
 * Transfer namespace — cross-database data transfer.
 *
 * Requires a connection. Both source and destination must be reachable.
 */
import type { Config } from '../../core/config/types.js';
import type { TransferOptions, TransferResult, TransferPlan } from '../../core/transfer/types.js';
import { transferData, getTransferPlan } from '../../core/transfer/index.js';
import { checkProtectedConfig } from '../guards.js';

import type { ContextState } from '../state.js';

// ─────────────────────────────────────────────────────────────
// TransferNamespace
// ─────────────────────────────────────────────────────────────

export class TransferNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    /**
     * Transfer data to a destination database.
     *
     * @example
     * ```typescript
     * const [result, err] = await ctx.noorm.transfer.to(destConfig, {
     *     tables: ['users', 'posts'],
     *     onConflict: 'skip',
     * })
     * ```
     */
    async to(
        destConfig: Config,
        options?: TransferOptions,
    ): Promise<[TransferResult | null, Error | null]> {

        // Gated against destConfig (the write target), not the source — the
        // SDK has no interactive prompt, so a `db:reset` confirm cell blocks
        // outright here, same as db.truncate()/dt.importFile().
        checkProtectedConfig(destConfig, this.#state.options, 'db:reset', 'transfer.to');

        return transferData(this.#state.config, destConfig, {
            ...options,
            channel: this.#state.options.channel ?? 'user',
        });

    }

    /**
     * Generate a transfer plan without executing.
     *
     * @example
     * ```typescript
     * const [plan, err] = await ctx.noorm.transfer.plan(destConfig)
     * ```
     */
    async plan(
        destConfig: Config,
        options?: TransferOptions,
    ): Promise<[TransferPlan | null, Error | null]> {

        return getTransferPlan(this.#state.config, destConfig, options);

    }

}
