/**
 * Change manager.
 *
 * High-level operations that combine parser, history, and executor
 * to provide the public API for change management.
 *
 * WHY: CLI commands need a simple interface to changes. The manager
 * provides this by coordinating the lower-level modules.
 *
 * @example
 * ```typescript
 * import { ChangeManager } from './manager'
 *
 * const manager = new ChangeManager(context)
 *
 * // List all changes
 * const list = await manager.list()
 *
 * // Run a specific change
 * const result = await manager.run('2024-01-15-add-users')
 *
 * // Run next pending
 * const batchResult = await manager.next(2)
 * ```
 */
import path from 'node:path';
import { stat } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';

import { failureListItem, parseChange, scanChanges } from './parser.js';
import type { ChangeParseFailure } from './parser.js';
import { deleteChange as deleteFromDisk } from './scaffold.js';
import { ChangeHistory } from './history.js';
import { executeChange, revertChange } from './executor.js';
import type {
    Change,
    ChangeContext,
    ChangeOptions,
    BatchChangeOptions,
    ChangeResult,
    BatchChangeResult,
    ChangeListItem,
    ChangeHistoryRecord,
    FileHistoryRecord,
} from './types.js';
import { ChangeNotFoundError, ChangeOrphanedError, isPendingChange } from './types.js';

// ─────────────────────────────────────────────────────────────
// Default Options
// ─────────────────────────────────────────────────────────────

const DEFAULT_BATCH: Required<Omit<BatchChangeOptions, 'output'>> & { output: string | null } = {
    force: false,
    dryRun: false,
    preview: false,
    output: null,
    abortOnError: true,
};

// ─────────────────────────────────────────────────────────────
// Manager Class
// ─────────────────────────────────────────────────────────────

/**
 * High-level change manager.
 *
 * Provides operations for listing, running, reverting, and
 * managing changes.
 *
 * @example
 * ```typescript
 * const manager = new ChangeManager(context)
 *
 * // List all changes with status
 * const list = await manager.list()
 *
 * for (const cs of list) {
 *     console.log(cs.name, cs.status, cs.orphaned ? '(orphaned)' : '')
 * }
 * ```
 */
export class ChangeManager {

    readonly #context: ChangeContext;
    readonly #history: ChangeHistory;

    constructor(context: ChangeContext) {

        this.#context = context;
        this.#history = new ChangeHistory(context.db, context.configName, context.dialect ?? 'postgres');

    }

    // ─────────────────────────────────────────────────────────
    // List
    // ─────────────────────────────────────────────────────────

    /**
     * List all changes with status.
     *
     * Merges changes from disk with status from database.
     * Includes orphaned changes (in DB but not on disk), and folders on disk
     * that cannot be parsed: `failed` with the parse error when they never
     * ran, otherwise their recorded status.
     *
     * @returns Array of changes with merged status
     */
    async list(): Promise<ChangeListItem[]> {

        const { items } = await this.#scan();

        return items;

    }

    /**
     * Merge disk and database state, and report the folders that cannot be read.
     *
     * An unreadable folder that a batch would run (never run, or `reverted` or
     * `stale`) is pending work: the batch fails at its position rather than
     * skipping it and running later changes out of order. `unreadable` holds the
     * applied ones; they keep their status and only warrant a warning.
     */
    async #scan(): Promise<{
        items: ChangeListItem[];
        unreadable: ChangeParseFailure[];
    }> {

        // Discover changes from disk
        const { changes: diskChanges, failures } = await scanChanges(
            this.#context.changesDir,
            this.#context.sqlDir,
        );

        // Get all statuses from DB
        const statuses = await this.#history.getAllStatuses();

        // Create set of disk names for orphan detection
        const diskNames = new Set([...diskChanges, ...failures].map((cs) => cs.name));

        // Get orphaned changes
        const orphanedNames = await this.#history.getOrphaned(diskNames);

        // Merge disk + DB
        const result: ChangeListItem[] = [];

        // Add disk changes with their status
        for (const cs of diskChanges) {

            const status = statuses.get(cs.name);

            result.push({
                ...cs,
                name: cs.name,
                status: status?.status ?? 'pending',
                appliedAt: status?.appliedAt ?? null,
                appliedBy: status?.appliedBy ?? null,
                revertedAt: status?.revertedAt ?? null,
                errorMessage: status?.errorMessage ?? null,
                appliedHistoryId: status?.appliedHistoryId ?? null,
                isNew: !status,
                orphaned: false,
            });

        }

        // Add folders that are on disk but cannot be parsed
        const unreadable: ChangeParseFailure[] = [];

        for (const failure of failures) {

            const status = statuses.get(failure.name);

            const item = failureListItem(failure, status);

            if (!isPendingChange(item)) {

                unreadable.push(failure);

            }

            result.push(item);

        }

        // Add orphaned changes
        for (const name of orphanedNames) {

            const status = statuses.get(name)!;

            result.push({
                name,
                status: status.status,
                appliedAt: status.appliedAt,
                appliedBy: status.appliedBy,
                revertedAt: status.revertedAt,
                errorMessage: status.errorMessage,
                appliedHistoryId: status.appliedHistoryId ?? null,
                isNew: false,
                orphaned: true,
                // Disk fields are not available for orphaned changes
                path: undefined,
                date: undefined,
                description: undefined,
                changeFiles: undefined,
                revertFiles: undefined,
                hasChangelog: undefined,
            });

        }

        // Sort by name
        return {
            items: result.sort((a, b) => a.name.localeCompare(b.name)),
            unreadable,
        };

    }

    // ─────────────────────────────────────────────────────────
    // Run Single Change
    // ─────────────────────────────────────────────────────────

    /**
     * Run a specific change by name.
     *
     * @param name - Change name
     * @param options - Execution options
     * @returns Execution result
     */
    async run(name: string, options: ChangeOptions = {}): Promise<ChangeResult> {

        const change = await this.#loadChange(name);

        return executeChange(this.#context, change, options);

    }

    /**
     * Run a change object directly.
     */
    async runChange(
        change: Change,
        options: ChangeOptions = {},
    ): Promise<ChangeResult> {

        return executeChange(this.#context, change, options);

    }

    // ─────────────────────────────────────────────────────────
    // Revert Single Change
    // ─────────────────────────────────────────────────────────

    /**
     * Revert a specific change by name.
     *
     * @param name - Change name
     * @param options - Execution options
     * @returns Execution result
     */
    async revert(name: string, options: ChangeOptions = {}): Promise<ChangeResult> {

        const change = await this.#loadChange(name);

        return revertChange(this.#context, change, options);

    }

    /**
     * Revert a change object directly.
     */
    async revertChange(
        change: Change,
        options: ChangeOptions = {},
    ): Promise<ChangeResult> {

        return revertChange(this.#context, change, options);

    }

    // ─────────────────────────────────────────────────────────
    // Batch Operations
    // ─────────────────────────────────────────────────────────

    /**
     * Run next N pending changes.
     *
     * @param count - Number of changes to run (default: 1)
     * @param options - Execution options
     * @returns Batch result
     */
    async next(
        count: number = 1,
        options: BatchChangeOptions = {},
    ): Promise<BatchChangeResult> {

        const opts = { ...DEFAULT_BATCH, ...options };
        const start = performance.now();

        const { items, unreadable } = await this.#scan();

        const messages = [
            ...(await this.#collectWarnings() ?? []),
            ...unreadable.map((f) => `Change '${f.name}' is applied but its files can no longer be read: ${f.message}`),
        ];
        const warnings = messages.length > 0 ? messages : undefined;

        // An unreadable pending change keeps its place in the sequence:
        // loading it fails, which stops the batch there.
        const pending = items
            .filter(isPendingChange)
            .slice(0, count);

        if (pending.length === 0) {

            return {
                status: 'success',
                changes: [],
                executed: 0,
                skipped: 0,
                failed: 0,
                durationMs: performance.now() - start,
                warnings,
            };

        }

        // Execute each
        const results: ChangeResult[] = [];
        let failed = 0;
        let executed = 0;

        for (const item of pending) {

            // Load full change from disk
            const [change, loadErr] = await attempt(() => this.#loadChange(item.name));

            if (loadErr) {

                results.push({
                    name: item.name,
                    direction: 'change',
                    status: 'failed',
                    files: [],
                    durationMs: 0,
                    error: loadErr.message,
                });

                failed++;

                if (opts.abortOnError) break;

                continue;

            }

            const result = await executeChange(this.#context, change, opts);
            results.push(result);

            if (result.status === 'success') {

                executed++;

            }
            else {

                failed++;

                if (opts.abortOnError) break;

            }

        }

        return {
            status: failed > 0 ? (executed > 0 ? 'partial' : 'failed') : 'success',
            changes: results,
            executed,
            skipped: pending.length - executed - failed,
            failed,
            durationMs: performance.now() - start,
            warnings,
        };

    }

    /**
     * Report conditions that silently shrink a batch to nothing.
     *
     * Kept separate from `list()` because an empty list is a legitimate
     * state ("nothing pending") while a missing directory is a mistake,
     * and the two are otherwise indistinguishable to the caller.
     */
    async #collectWarnings(): Promise<string[] | undefined> {

        const [dir] = await attempt(() => stat(this.#context.changesDir));

        if (dir) return undefined;

        return [`Changes directory not found: ${this.#context.changesDir}`];

    }

    /**
     * Fast-forward: run all pending changes.
     *
     * @param options - Execution options
     * @returns Batch result
     */
    async ff(options: BatchChangeOptions = {}): Promise<BatchChangeResult> {

        return this.next(Number.POSITIVE_INFINITY, options);

    }

    /**
     * Rewind: revert changes in reverse order.
     *
     * @param target - Number of changes to revert, or name to revert to
     * @param options - Execution options
     * @returns Batch result
     */
    async rewind(
        target: number | string,
        options: BatchChangeOptions = {},
    ): Promise<BatchChangeResult> {

        const opts = { ...DEFAULT_BATCH, ...options };
        const start = performance.now();

        // Get applied changes sorted by appliedAt (most recent first), tiebreaking
        // on the history table's autoincrement id -- appliedAt is second-precision,
        // so changes applied within the same tick (e.g. `change ff`) tie, and the
        // id is the only reliable true apply-order key. appliedAt stays primary
        // because not every applied entry is guaranteed to carry an id (older/
        // partial hydration paths leave it undefined).
        const list = await this.list();
        const applied = list
            .filter((cs) => !cs.orphaned && cs.status === 'success' && cs.appliedAt)
            .sort((a, b) => {

                const aTime = a.appliedAt?.getTime() ?? 0;
                const bTime = b.appliedAt?.getTime() ?? 0;

                if (aTime !== bTime) {

                    return bTime - aTime; // Most recent first

                }

                const aId = a.appliedHistoryId ?? 0;
                const bId = b.appliedHistoryId ?? 0;

                return bId - aId; // Tie: most recently applied (highest id) first

            });

        // Determine which to revert
        let toRevert: typeof applied;

        if (typeof target === 'number') {

            toRevert = applied.slice(0, target);

        }
        else {

            // Revert until (and including) the named change
            const targetIndex = applied.findIndex((cs) => cs.name === target);

            if (targetIndex === -1) {

                return {
                    status: 'failed',
                    changes: [],
                    executed: 0,
                    skipped: 0,
                    failed: 1,
                    durationMs: performance.now() - start,
                    error: `No applied change named "${target}" to rewind to`,
                };

            }

            toRevert = applied.slice(0, targetIndex + 1);

        }

        if (toRevert.length === 0) {

            return {
                status: 'success',
                changes: [],
                executed: 0,
                skipped: 0,
                failed: 0,
                durationMs: performance.now() - start,
            };

        }

        // Revert each
        const results: ChangeResult[] = [];
        let failed = 0;
        let executed = 0;
        let skipped = 0;

        for (const item of toRevert) {

            // Check if already reverted
            if (item.status === 'reverted') {

                results.push({
                    name: item.name,
                    direction: 'revert',
                    status: 'success',
                    files: [],
                    durationMs: 0,
                });

                skipped++;
                continue;

            }

            // Load full change from disk
            const [change, loadErr] = await attempt(() => this.#loadChange(item.name));

            if (loadErr) {

                results.push({
                    name: item.name,
                    direction: 'revert',
                    status: 'failed',
                    files: [],
                    durationMs: 0,
                    error: loadErr.message,
                });

                failed++;

                if (opts.abortOnError) break;

                continue;

            }

            const result = await revertChange(this.#context, change, opts);
            results.push(result);

            if (result.status === 'success') {

                executed++;

            }
            else {

                failed++;

                if (opts.abortOnError) break;

            }

        }

        return {
            status: failed > 0 ? (executed > 0 ? 'partial' : 'failed') : 'success',
            changes: results,
            executed,
            skipped,
            failed,
            durationMs: performance.now() - start,
        };

    }

    // ─────────────────────────────────────────────────────────
    // History
    // ─────────────────────────────────────────────────────────

    /**
     * Get execution history.
     *
     * @param name - Optional change name (all if not provided)
     * @param limit - Max records to return
     * @returns Array of history records
     */
    async getHistory(name?: string, limit?: number): Promise<ChangeHistoryRecord[]> {

        return this.#history.getHistory(name, limit);

    }

    /**
     * Get file execution history for an operation.
     */
    async getFileHistory(operationId: number): Promise<FileHistoryRecord[]> {

        return this.#history.getFileHistory(operationId);

    }

    // ─────────────────────────────────────────────────────────
    // Remove
    // ─────────────────────────────────────────────────────────

    /**
     * Remove a change from disk, database, or both.
     *
     * @param name - Change name
     * @param options - What to remove
     */
    async remove(name: string, options: { disk?: boolean; db?: boolean }): Promise<void> {

        if (options.disk) {

            const changePath = path.join(this.#context.changesDir, name);

            const [change, loadErr] = await attempt(() =>
                parseChange(changePath, this.#context.sqlDir),
            );

            if (!loadErr && change) {

                await deleteFromDisk(change);

            }

        }

        if (options.db) {

            await this.#history.deleteRecords(name);

        }

    }

    // ─────────────────────────────────────────────────────────
    // Get Single Change
    // ─────────────────────────────────────────────────────────

    /**
     * Get a specific change by name.
     */
    async get(name: string): Promise<ChangeListItem | null> {

        const list = await this.list();

        return list.find((cs) => cs.name === name) ?? null;

    }

    /**
     * Load a change from disk.
     */
    async load(name: string): Promise<Change> {

        return this.#loadChange(name);

    }

    // ─────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────

    /**
     * Load a change from disk by name.
     */
    async #loadChange(name: string): Promise<Change> {

        const changePath = path.join(this.#context.changesDir, name);

        const [change, err] = await attempt(() =>
            parseChange(changePath, this.#context.sqlDir),
        );

        if (err) {

            // A folder that is there but will not parse needs its own error:
            // "not found" sends the user looking for a file that exists.
            const [onDisk] = await attempt(() => stat(changePath));

            if (onDisk) throw err;

            // Check if it exists in DB (orphaned)
            const status = await this.#history.getStatus(name);

            if (status) {

                throw new ChangeOrphanedError(name);

            }

            throw new ChangeNotFoundError(name);

        }

        return change;

    }

}
