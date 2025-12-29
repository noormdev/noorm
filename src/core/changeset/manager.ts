/**
 * Changeset manager.
 *
 * High-level operations that combine parser, history, and executor
 * to provide the public API for changeset management.
 *
 * WHY: CLI commands need a simple interface to changesets. The manager
 * provides this by coordinating the lower-level modules.
 *
 * @example
 * ```typescript
 * import { ChangesetManager } from './manager'
 *
 * const manager = new ChangesetManager(context)
 *
 * // List all changesets
 * const list = await manager.list()
 *
 * // Run a specific changeset
 * const result = await manager.run('2024-01-15-add-users')
 *
 * // Run next pending
 * const batchResult = await manager.next(2)
 * ```
 */
import path from 'node:path';

import { attempt } from '@logosdx/utils';

import { parseChangeset, discoverChangesets } from './parser.js';
import { deleteChangeset as deleteFromDisk } from './scaffold.js';
import { ChangesetHistory } from './history.js';
import { executeChangeset, revertChangeset } from './executor.js';
import type {
    Changeset,
    ChangesetContext,
    ChangesetOptions,
    BatchChangesetOptions,
    ChangesetResult,
    BatchChangesetResult,
    ChangesetListItem,
    ChangesetHistoryRecord,
    FileHistoryRecord,
} from './types.js';
import { ChangesetNotFoundError, ChangesetOrphanedError } from './types.js';

// ─────────────────────────────────────────────────────────────
// Default Options
// ─────────────────────────────────────────────────────────────

const DEFAULT_BATCH: Required<Omit<BatchChangesetOptions, 'output'>> & { output: string | null } = {
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
 * High-level changeset manager.
 *
 * Provides operations for listing, running, reverting, and
 * managing changesets.
 *
 * @example
 * ```typescript
 * const manager = new ChangesetManager(context)
 *
 * // List all changesets with status
 * const list = await manager.list()
 *
 * for (const cs of list) {
 *     console.log(cs.name, cs.status, cs.orphaned ? '(orphaned)' : '')
 * }
 * ```
 */
export class ChangesetManager {

    readonly #context: ChangesetContext;
    readonly #history: ChangesetHistory;

    constructor(context: ChangesetContext) {

        this.#context = context;
        this.#history = new ChangesetHistory(context.db, context.configName);

    }

    // ─────────────────────────────────────────────────────────
    // List
    // ─────────────────────────────────────────────────────────

    /**
     * List all changesets with status.
     *
     * Merges changesets from disk with status from database.
     * Includes orphaned changesets (in DB but not on disk).
     *
     * @returns Array of changesets with merged status
     */
    async list(): Promise<ChangesetListItem[]> {

        // Discover changesets from disk
        const diskChangesets = await discoverChangesets(
            this.#context.changesetsDir,
            this.#context.schemaDir,
        );

        // Get all statuses from DB
        const statuses = await this.#history.getAllStatuses();

        // Create set of disk names for orphan detection
        const diskNames = new Set(diskChangesets.map((cs) => cs.name));

        // Get orphaned changesets
        const orphanedNames = await this.#history.getOrphaned(diskNames);

        // Merge disk + DB
        const result: ChangesetListItem[] = [];

        // Add disk changesets with their status
        for (const cs of diskChangesets) {

            const status = statuses.get(cs.name);

            result.push({
                ...cs,
                name: cs.name,
                status: status?.status ?? 'pending',
                appliedAt: status?.appliedAt ?? null,
                appliedBy: status?.appliedBy ?? null,
                revertedAt: status?.revertedAt ?? null,
                errorMessage: status?.errorMessage ?? null,
                isNew: !status,
                orphaned: false,
            });

        }

        // Add orphaned changesets
        for (const name of orphanedNames) {

            const status = statuses.get(name)!;

            result.push({
                name,
                status: status.status,
                appliedAt: status.appliedAt,
                appliedBy: status.appliedBy,
                revertedAt: status.revertedAt,
                errorMessage: status.errorMessage,
                isNew: false,
                orphaned: true,
                // Disk fields are not available for orphaned changesets
                path: undefined,
                date: undefined,
                description: undefined,
                changeFiles: undefined,
                revertFiles: undefined,
                hasChangelog: undefined,
            });

        }

        // Sort by name
        return result.sort((a, b) => a.name.localeCompare(b.name));

    }

    // ─────────────────────────────────────────────────────────
    // Run Single Changeset
    // ─────────────────────────────────────────────────────────

    /**
     * Run a specific changeset by name.
     *
     * @param name - Changeset name
     * @param options - Execution options
     * @returns Execution result
     */
    async run(name: string, options: ChangesetOptions = {}): Promise<ChangesetResult> {

        const changeset = await this.#loadChangeset(name);

        return executeChangeset(this.#context, changeset, options);

    }

    /**
     * Run a changeset object directly.
     */
    async runChangeset(
        changeset: Changeset,
        options: ChangesetOptions = {},
    ): Promise<ChangesetResult> {

        return executeChangeset(this.#context, changeset, options);

    }

    // ─────────────────────────────────────────────────────────
    // Revert Single Changeset
    // ─────────────────────────────────────────────────────────

    /**
     * Revert a specific changeset by name.
     *
     * @param name - Changeset name
     * @param options - Execution options
     * @returns Execution result
     */
    async revert(name: string, options: ChangesetOptions = {}): Promise<ChangesetResult> {

        const changeset = await this.#loadChangeset(name);

        return revertChangeset(this.#context, changeset, options);

    }

    /**
     * Revert a changeset object directly.
     */
    async revertChangeset(
        changeset: Changeset,
        options: ChangesetOptions = {},
    ): Promise<ChangesetResult> {

        return revertChangeset(this.#context, changeset, options);

    }

    // ─────────────────────────────────────────────────────────
    // Batch Operations
    // ─────────────────────────────────────────────────────────

    /**
     * Run next N pending changesets.
     *
     * @param count - Number of changesets to run (default: 1)
     * @param options - Execution options
     * @returns Batch result
     */
    async next(
        count: number = 1,
        options: BatchChangesetOptions = {},
    ): Promise<BatchChangesetResult> {

        const opts = { ...DEFAULT_BATCH, ...options };
        const start = performance.now();

        // Get pending changesets
        const list = await this.list();
        const pending = list
            .filter((cs) => !cs.orphaned && (cs.status === 'pending' || cs.status === 'reverted'))
            .slice(0, count);

        if (pending.length === 0) {

            return {
                status: 'success',
                changesets: [],
                executed: 0,
                skipped: 0,
                failed: 0,
                durationMs: performance.now() - start,
            };

        }

        // Execute each
        const results: ChangesetResult[] = [];
        let failed = 0;
        let executed = 0;

        for (const item of pending) {

            // Load full changeset from disk
            const [changeset, loadErr] = await attempt(() => this.#loadChangeset(item.name));

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

            const result = await executeChangeset(this.#context, changeset, opts);
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
            changesets: results,
            executed,
            skipped: pending.length - executed - failed,
            failed,
            durationMs: performance.now() - start,
        };

    }

    /**
     * Fast-forward: run all pending changesets.
     *
     * @param options - Execution options
     * @returns Batch result
     */
    async ff(options: BatchChangesetOptions = {}): Promise<BatchChangesetResult> {

        // Get count of pending
        const list = await this.list();
        const pendingCount = list.filter(
            (cs) => !cs.orphaned && (cs.status === 'pending' || cs.status === 'reverted'),
        ).length;

        return this.next(pendingCount, options);

    }

    /**
     * Rewind: revert changesets in reverse order.
     *
     * @param target - Number of changesets to revert, or name to revert to
     * @param options - Execution options
     * @returns Batch result
     */
    async rewind(
        target: number | string,
        options: BatchChangesetOptions = {},
    ): Promise<BatchChangesetResult> {

        const opts = { ...DEFAULT_BATCH, ...options };
        const start = performance.now();

        // Get applied changesets sorted by appliedAt (most recent first)
        const list = await this.list();
        const applied = list
            .filter((cs) => !cs.orphaned && cs.status === 'success' && cs.appliedAt)
            .sort((a, b) => {

                const aTime = a.appliedAt?.getTime() ?? 0;
                const bTime = b.appliedAt?.getTime() ?? 0;

                return bTime - aTime; // Most recent first

            });

        // Determine which to revert
        let toRevert: typeof applied;

        if (typeof target === 'number') {

            toRevert = applied.slice(0, target);

        }
        else {

            // Revert until (and including) the named changeset
            const targetIndex = applied.findIndex((cs) => cs.name === target);

            if (targetIndex === -1) {

                return {
                    status: 'failed',
                    changesets: [],
                    executed: 0,
                    skipped: 0,
                    failed: 1,
                    durationMs: performance.now() - start,
                };

            }

            toRevert = applied.slice(0, targetIndex + 1);

        }

        if (toRevert.length === 0) {

            return {
                status: 'success',
                changesets: [],
                executed: 0,
                skipped: 0,
                failed: 0,
                durationMs: performance.now() - start,
            };

        }

        // Revert each
        const results: ChangesetResult[] = [];
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

            // Load full changeset from disk
            const [changeset, loadErr] = await attempt(() => this.#loadChangeset(item.name));

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

            const result = await revertChangeset(this.#context, changeset, opts);
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
            changesets: results,
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
     * @param name - Optional changeset name (all if not provided)
     * @param limit - Max records to return
     * @returns Array of history records
     */
    async getHistory(name?: string, limit?: number): Promise<ChangesetHistoryRecord[]> {

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
     * Remove a changeset from disk, database, or both.
     *
     * @param name - Changeset name
     * @param options - What to remove
     */
    async remove(name: string, options: { disk?: boolean; db?: boolean }): Promise<void> {

        if (options.disk) {

            const changesetPath = path.join(this.#context.changesetsDir, name);

            const [changeset, loadErr] = await attempt(() =>
                parseChangeset(changesetPath, this.#context.schemaDir),
            );

            if (!loadErr && changeset) {

                await deleteFromDisk(changeset);

            }

        }

        if (options.db) {

            await this.#history.deleteRecords(name);

        }

    }

    // ─────────────────────────────────────────────────────────
    // Get Single Changeset
    // ─────────────────────────────────────────────────────────

    /**
     * Get a specific changeset by name.
     */
    async get(name: string): Promise<ChangesetListItem | null> {

        const list = await this.list();

        return list.find((cs) => cs.name === name) ?? null;

    }

    /**
     * Load a changeset from disk.
     */
    async load(name: string): Promise<Changeset> {

        return this.#loadChangeset(name);

    }

    // ─────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────

    /**
     * Load a changeset from disk by name.
     */
    async #loadChangeset(name: string): Promise<Changeset> {

        const changesetPath = path.join(this.#context.changesetsDir, name);

        const [changeset, err] = await attempt(() =>
            parseChangeset(changesetPath, this.#context.schemaDir),
        );

        if (err) {

            // Check if it exists in DB (orphaned)
            const status = await this.#history.getStatus(name);

            if (status) {

                throw new ChangesetOrphanedError(name);

            }

            throw new ChangesetNotFoundError(name);

        }

        return changeset;

    }

}
