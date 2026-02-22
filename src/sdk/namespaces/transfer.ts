/**
 * Transfer namespace — cross-database data transfer.
 *
 * Requires a connection. Both source and destination must be reachable.
 */
import type { Config } from '../../core/config/types.js';
import type { TransferOptions, TransferResult, TransferPlan } from '../../core/transfer/types.js';
import { transferData, getTransferPlan } from '../../core/transfer/index.js';

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

        return transferData(this.#state.config, destConfig, options);

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
