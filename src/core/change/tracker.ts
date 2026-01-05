/**
 * Change-specific tracker.
 *
 * Extends the base Tracker with change-specific operations like
 * revert handling and stale marking.
 *
 * WHY: Changes have special operations that don't apply to builds/runs:
 * - Revert support (check if can revert, mark as reverted)
 * - Stale marking (after teardown, all applied changes become stale)
 *
 * @example
 * ```typescript
 * import { ChangeTracker } from './tracker'
 *
 * const tracker = new ChangeTracker(db, 'production')
 *
 * // Check if change can be reverted
 * const result = await tracker.canRevert('2024-01-15-add-users', false)
 *
 * // Mark original change as reverted
 * await tracker.markAsReverted('2024-01-15-add-users')
 *
 * // After teardown, mark all as stale
 * await tracker.markAllAsStale()
 * ```
 */
import { attempt } from '@logosdx/utils';

import { Tracker } from '../runner/tracker.js';
import { observer } from '../observer.js';
import { NOORM_TABLES } from '../shared/index.js';
import type { NoormDatabase, OperationStatus } from '../shared/index.js';
import type { Kysely } from 'kysely';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * Result of checking if a change can be reverted.
 */
export interface CanRevertResult {
    /** Whether revert is allowed */
    canRevert: boolean;

    /** Reason why revert is not allowed (if canRevert is false) */
    reason?: string;

    /** Current status of the change */
    status?: OperationStatus;
}

// ─────────────────────────────────────────────────────────────
// ChangeTracker Class
// ─────────────────────────────────────────────────────────────

/**
 * Change-specific tracker.
 *
 * Extends Tracker with operations specific to change management:
 * - Revert checking and marking
 * - Stale marking after teardown
 *
 * @example
 * ```typescript
 * const tracker = new ChangeTracker(db, 'dev')
 *
 * // Use inherited methods from Tracker
 * const opId = await tracker.createOperation({
 *     name: 'my-change',
 *     changeType: 'change',
 *     direction: 'commit',
 *     configName: 'dev',
 *     executedBy: 'user@example.com',
 * })
 *
 * // Use change-specific methods
 * const canRevert = await tracker.canRevert('my-change', false)
 * ```
 */
export class ChangeTracker extends Tracker {

    // Store db and configName for change-specific queries
    // (Tracker uses private fields, so we need our own references)
    readonly #db: Kysely<NoormDatabase>;
    readonly #configName: string;

    constructor(db: Kysely<NoormDatabase>, configName: string) {

        super(db, configName);
        this.#db = db;
        this.#configName = configName;

    }

    /**
     * Check if a change can be reverted.
     *
     * @param name - Change name
     * @param force - Force revert regardless of status
     * @returns Whether revert is allowed and current status
     */
    async canRevert(name: string, force: boolean): Promise<CanRevertResult> {

        // Get most recent change record
        const [record, err] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.change)
                .select(['status'])
                .where('name', '=', name)
                .where('change_type', '=', 'change')
                .where('direction', '=', 'change') // 'change' = forward/commit in DB
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
        );

        if (err) {

            observer.emit('error', {
                source: 'change',
                error: err,
                context: { name, operation: 'can-revert' },
            });

            return { canRevert: false, reason: 'database error' };

        }

        if (!record) {

            return { canRevert: false, reason: 'not applied' };

        }

        if (force) {

            return { canRevert: true, status: record.status };

        }

        switch (record.status) {

        case 'pending':
            return { canRevert: false, reason: 'not applied yet', status: record.status };

        case 'success':
            return { canRevert: true, status: record.status };

        case 'failed':
            return { canRevert: true, status: record.status };

        case 'reverted':
            return { canRevert: false, reason: 'already reverted', status: record.status };

        case 'stale':
            return { canRevert: false, reason: 'schema was torn down', status: record.status };

        default:
            return { canRevert: false, reason: 'unknown status' };

        }

    }

    /**
     * Mark the original change record as reverted.
     *
     * Called after successful revert.
     *
     * @param name - Change name to mark as reverted
     */
    async markAsReverted(name: string): Promise<void> {

        // Find the most recent 'change' record
        const [record] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.change)
                .select(['id'])
                .where('name', '=', name)
                .where('change_type', '=', 'change')
                .where('direction', '=', 'change')
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
        );

        if (record) {

            await attempt(() =>
                this.#db
                    .updateTable(NOORM_TABLES.change)
                    .set({ status: 'reverted' })
                    .where('id', '=', record.id)
                    .execute(),
            );

        }

    }

    /**
     * Mark all operation records as stale.
     *
     * Called during teardown to indicate schema objects no longer exist.
     * Marks changes, builds, and runs - all types that created schema objects.
     * Marks 'success', 'failed', and 'pending' records - anything that might have
     * created schema objects needs to be re-run after teardown.
     *
     * @returns Number of records marked as stale
     */
    async markAllAsStale(): Promise<number> {

        const [result, err] = await attempt(() =>
            this.#db
                .updateTable(NOORM_TABLES.change)
                .set({ status: 'stale' })
                .where('direction', '=', 'change') // Only forward operations
                .where('status', 'in', ['success', 'failed', 'pending'])
                .where('config_name', '=', this.#configName)
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'change',
                error: err,
                context: { operation: 'mark-all-stale' },
            });

            return 0;

        }

        return result.reduce((acc, r) => acc + Number(r.numUpdatedRows ?? 0), 0);

    }

}
