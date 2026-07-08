/**
 * Data transfer module.
 *
 * Provides cross-database data transfer functionality with:
 * - Same-server optimization (direct SQL)
 * - Cross-server batch transfers
 * - Configurable conflict resolution
 * - FK ordering with dependency analysis
 * - Identity column preservation
 *
 * @example
 * ```typescript
 * const [result, err] = await transferData(sourceConfig, destConfig, {
 *     tables: ['users', 'posts'],
 *     onConflict: 'skip',
 *     batchSize: 5000,
 * });
 *
 * if (err) {
 *     console.error('Transfer failed:', err.message);
 * } else {
 *     console.log(`Transferred ${result.totalRows} rows`);
 * }
 * ```
 */
import { attemptSync } from '@logosdx/utils';

import { withDualConnection } from '../db/dual.js';
import { assertPolicy } from '../policy/index.js';
import type { Config } from '../config/types.js';
import type { TransferOptions, TransferResult, TransferPlan } from './types.js';

import { planTransfer } from './planner.js';
import { executeTransfer } from './executor.js';
import { isTransferSupported, TRANSFER_SUPPORTED_DIALECTS } from './dialects/index.js';

/**
 * Transfer data between two database configurations.
 *
 * Both databases must use the same dialect (PostgreSQL, MySQL, or MSSQL).
 * Tables are transferred in FK dependency order.
 *
 * @param sourceConfig - Source database config
 * @param destConfig - Destination database config
 * @param options - Transfer options
 * @returns Transfer result or error
 *
 * @example
 * ```typescript
 * // Transfer all tables
 * const [result, err] = await transferData(staging, production);
 *
 * // Transfer specific tables with options
 * const [result, err] = await transferData(staging, production, {
 *     tables: ['users', 'posts', 'comments'],
 *     onConflict: 'update',
 *     batchSize: 2000,
 *     truncateFirst: true,
 * });
 *
 * // Dry run to see the plan
 * const [result, err] = await transferData(staging, production, {
 *     dryRun: true,
 * });
 * console.log(result.plan.tables); // Shows table order
 * ```
 */
export async function transferData(
    sourceConfig: Config,
    destConfig: Config,
    options: TransferOptions = {},
): Promise<[TransferResult | null, Error | null]> {

    // Transfer writes into the destination — that's the destructive act,
    // so the gate targets destConfig, not sourceConfig. Checked before any
    // connection opens; dry runs are gated too (the matrix has no carve-out).
    const [, policyErr] = attemptSync(() => assertPolicy(options.channel ?? 'user', destConfig, 'db:reset'));

    if (policyErr) {

        return [null, policyErr];

    }

    // Validate dialects are supported
    const srcDialect = sourceConfig.connection.dialect;
    const dstDialect = destConfig.connection.dialect;

    if (!isTransferSupported(srcDialect)) {

        return [null, new Error(`Transfer not supported for dialect: ${srcDialect}. Supported: ${TRANSFER_SUPPORTED_DIALECTS.join(', ')}`)];

    }

    if (!isTransferSupported(dstDialect)) {

        return [null, new Error(`Transfer not supported for dialect: ${dstDialect}. Supported: ${TRANSFER_SUPPORTED_DIALECTS.join(', ')}`)];

    }

    // Use dual connection infrastructure
    return withDualConnection(
        {
            sourceConfig,
            destConfig,
            ensureSchema: false, // Don't create noorm tables on destination
        },
        async (ctx) => {

            // Plan the transfer
            const [plan, planErr] = await planTransfer(ctx, options);

            if (planErr) {

                throw planErr;

            }

            if (!plan || plan.tables.length === 0) {

                return {
                    status: 'success',
                    tables: [],
                    totalRows: 0,
                    durationMs: 0,
                };

            }

            // Dry run - return plan info
            if (options.dryRun) {

                return {
                    status: 'success',
                    tables: plan.tables.map((t) => ({
                        table: t.name,
                        status: 'skipped' as const,
                        rowsTransferred: 0,
                        rowsSkipped: 0,
                        durationMs: 0,
                    })),
                    totalRows: 0,
                    durationMs: 0,
                };

            }

            // Execute the transfer
            const [result, execErr] = await executeTransfer(ctx, plan, options);

            if (execErr) {

                throw execErr;

            }

            return result!;

        },
    );

}

/**
 * Get transfer plan without executing.
 *
 * Useful for previewing what will be transferred.
 *
 * @param sourceConfig - Source database config
 * @param destConfig - Destination database config
 * @param options - Transfer options
 * @returns Transfer plan or error
 */
export async function getTransferPlan(
    sourceConfig: Config,
    destConfig: Config,
    options: TransferOptions = {},
): Promise<[TransferPlan | null, Error | null]> {

    // Validate dialects are supported
    const srcDialect = sourceConfig.connection.dialect;
    const dstDialect = destConfig.connection.dialect;

    if (!isTransferSupported(srcDialect)) {

        return [null, new Error(`Transfer not supported for dialect: ${srcDialect}`)];

    }

    if (!isTransferSupported(dstDialect)) {

        return [null, new Error(`Transfer not supported for dialect: ${dstDialect}`)];

    }

    return withDualConnection(
        {
            sourceConfig,
            destConfig,
            ensureSchema: false,
        },
        async (ctx) => {

            const [plan, err] = await planTransfer(ctx, options);

            if (err) {

                throw err;

            }

            return plan!;

        },
    );

}

// Re-export types
export type {
    TransferOptions,
    TransferPlan,
    TransferTablePlan,
    TransferResult,
    TransferTableResult,
    ConflictStrategy,
} from './types.js';

export type { TransferEvents } from './events.js';

// Re-export utilities
export { isSameServer } from './same-server.js';
export { isTransferSupported, TRANSFER_SUPPORTED_DIALECTS } from './dialects/index.js';
