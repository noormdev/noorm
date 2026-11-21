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
import { assertApprovedPending, hasApprovedContent } from '../shared/approved-content.js';
import type { Direction } from '../shared/tables.js';
import { assertPolicy } from '../policy/index.js';
import { appendRetiredChanges, assertNotRetired, readRetiredChanges } from './retirement.js';
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
import { ChangeNotFoundError, ChangeOrphanedError, ChangeRetiredError, DEFAULT_BATCH_OPTIONS, isPendingChange } from './types.js';

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
     * Merge project retirement, forward files and recorded database status.
     * Applied changes with unreadable forward files retain their status.
     */
    async #scan(throwOnReadError = false) {

        const retired = await readRetiredChanges(this.#context.projectRoot);
        const { changes: diskChanges, failures } = await scanChanges(
            this.#context.changesDir,
            this.#context.sqlDir,
            { retired, direction: 'change' },
        );

        // Get all statuses from DB
        const statuses = await this.#history.getAllStatuses(throwOnReadError);

        // Create set of disk names for orphan detection
        const diskNames = new Set([...diskChanges, ...failures].map((cs) => cs.name));

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

            if (item.status === 'success') {

                unreadable.push(failure);

            }

            result.push(item);

        }

        for (const name of retired) {

            const status = statuses.get(name);

            result.push({
                name,
                status: status?.status ?? 'pending',
                appliedAt: status?.appliedAt ?? null,
                appliedBy: status?.appliedBy ?? null,
                revertedAt: status?.revertedAt ?? null,
                errorMessage: status?.errorMessage ?? null,
                appliedHistoryId: status?.appliedHistoryId ?? null,
                isNew: !status,
                orphaned: false,
                retired: true,
            });

        }

        // Add orphaned changes
        for (const [name, status] of statuses) {

            if (diskNames.has(name) || retired.has(name)) continue;

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
            failures,
            unreadable,
            statuses,
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

        const change = await this.#loadChange(name, 'change');

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

        const change = await this.#loadChange(name, 'revert');

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

        const start = performance.now();
        const scan = await this.#scan();
        const pending = scan.items.filter(isPendingChange).slice(0, count);

        assertApprovedPending(pending.map((item) => item.name));

        return this.#runPending(pending, options, start, await this.#batchWarnings(scan.unreadable));

    }

    async #runPending(
        pending: ChangeListItem[],
        options: BatchChangeOptions,
        start: number,
        warnings: string[] | undefined,
    ): Promise<BatchChangeResult> {

        const opts = { ...DEFAULT_BATCH_OPTIONS, ...options };

        // Execute each
        const results: ChangeResult[] = [];
        let failed = 0;
        let executed = 0;

        for (const item of pending) {

            // Load full change from disk
            const [change, loadErr] = await attempt(() => this.#loadChange(item.name, 'change'));

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

    async #batchWarnings(unreadable: ChangeParseFailure[]): Promise<string[] | undefined> {

        const warnings = [
            ...(await this.#collectWarnings() ?? []),
            ...unreadable.map((failure) => `Change '${failure.name}' is applied but its files can no longer be read: ${failure.message}`),
        ];

        return warnings.length > 0 ? warnings : undefined;

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

        const start = performance.now();
        let plan = await this.#planFastForward();
        assertApprovedPending(plan.pending.map((item) => item.name));

        const confirm = options.confirmRetirement;

        const { projectRoot, channel, configName, access } = this.#context;

        if (confirm && channel === 'user' && !options.dryRun && !options.preview
            && !hasApprovedContent() && plan.candidates.size > 0) {

            assertPolicy(channel, { name: configName, access }, 'change:run');

            const approved = plan.candidates;
            const offered = Array.from(approved, ([name, message]) => ({ name, message }));
            const selected = (await confirm(offered)).filter((name) => approved.has(name));

            if (selected.length > 0) {

                await appendRetiredChanges(projectRoot, async () => {

                    const current = await this.#planFastForward();

                    return selected.filter((name) =>
                        current.candidates.get(name) === approved.get(name),
                    );

                });

                plan = await this.#planFastForward();

            }

        }

        const warnings = await this.#batchWarnings(plan.unreadable);

        if (plan.failures.length > 0) {

            return {
                status: 'failed',
                changes: plan.failures,
                executed: 0,
                skipped: plan.pending.length - plan.pendingFailures,
                failed: plan.failures.length,
                durationMs: performance.now() - start,
                warnings,
            };

        }

        return this.#runPending(plan.pending, options, start, warnings);

    }

    /** Inspect the strict fast-forward plan without rendering or executing it. */
    async preflightFastForward() {

        const { pending, failures } = await this.#planFastForward();

        return { pending: pending.length, failures };

    }

    async #planFastForward() {

        const scan = await this.#scan(true);
        const parseFailures = new Map(scan.failures.map((failure) => [failure.name, failure]));
        const candidates = new Map<string, string>();
        const pending: ChangeListItem[] = [];
        const failures: ChangeResult[] = [];
        let pendingFailures = 0;

        for (const item of scan.items) {

            const parseFailure = parseFailures.get(item.name);
            const isPending = isPendingChange(item);
            const unresolved = !item.isNew && (item.status === 'pending' || item.status === 'failed');
            const unresolvedRevert = scan.statuses.get(item.name)?.unresolvedRevert;
            if (isPending) pending.push(item);

            let error: string;
            if ((unresolved || unresolvedRevert) && (item.retired || parseFailure)) {

                error = unresolvedRevert
                    ? unresolvedRevert.errorMessage ?? `Change '${item.name}' has an unresolved recorded rollback (${unresolvedRevert.status})`
                    : item.errorMessage ?? `Change '${item.name}' has an unresolved recorded execution (${item.status})`;
                if (isPending && parseFailure) error = `${error}\n${parseFailure.message}`;

            }
            else if (isPending && parseFailure) {

                error = parseFailure.message;
                if (parseFailure.missingForwardReferences) candidates.set(item.name, error);

            }
            else {

                continue;

            }

            if (isPending) pendingFailures++;
            failures.push({ name: item.name, direction: 'change', status: 'failed', files: [], durationMs: 0, error });

        }

        return { pending, failures, pendingFailures, candidates, unreadable: scan.unreadable };

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

        const opts = { ...DEFAULT_BATCH_OPTIONS, ...options };
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

        const retired = toRevert.find((item) => item.retired);

        if (retired) {

            return {
                status: 'failed',
                changes: [],
                executed: 0,
                skipped: 0,
                failed: 1,
                durationMs: performance.now() - start,
                error: `Cannot rewind across retired change '${retired.name}'`,
            };

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
        let blockedByRetirement: string | undefined;
        let retirementRange = opts.dryRun || opts.preview ? undefined : toRevert.map((item) => item.name);

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
            const [change, loadErr] = await attempt(() => this.#loadChange(item.name, 'revert'));

            if (loadErr instanceof ChangeRetiredError) {

                blockedByRetirement = loadErr.changeName;
                failed++;
                break;

            }

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

            const [result, revertErr] = await attempt(() => revertChange(this.#context, change, opts, retirementRange));

            if (revertErr) {

                if (!(revertErr instanceof ChangeRetiredError)) throw revertErr;
                blockedByRetirement = revertErr.changeName;
                failed++;
                break;

            }

            if (result.files.length > 0) retirementRange = undefined;
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
            ...(blockedByRetirement && { error: `Cannot rewind across retired change '${blockedByRetirement}'` }),
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
    async load(name: string, direction?: Direction): Promise<Change> {

        return this.#loadChange(name, direction);

    }

    // ─────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────

    /**
     * Load a change from disk by name.
     */
    async #loadChange(name: string, direction?: Direction): Promise<Change> {

        await assertNotRetired(this.#context.projectRoot, name);

        const changePath = path.join(this.#context.changesDir, name);

        const [change, err] = await attempt(() =>
            parseChange(changePath, this.#context.sqlDir, direction),
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
