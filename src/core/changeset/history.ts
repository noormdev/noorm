/**
 * Changeset history tracking.
 *
 * Database operations for tracking changeset execution. Provides
 * change detection, status queries, and execution recording.
 *
 * WHY: Changeset execution must be tracked to enable:
 * - Idempotent execution (skip already-applied changesets)
 * - Audit trail (who ran what, when)
 * - Status visibility (list command)
 * - Safe reverts (know what was applied)
 *
 * @example
 * ```typescript
 * import { ChangesetHistory } from './history'
 *
 * const history = new ChangesetHistory(db, 'production')
 *
 * // Check if changeset needs to run
 * const result = await history.needsRun('2024-01-15-add-users', 'abc123...')
 *
 * // Get status
 * const status = await history.getStatus('2024-01-15-add-users')
 * ```
 */
import type { Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import { NOORM_TABLES } from '../shared/index.js';
import type {
    NoormDatabase,
    OperationStatus,
    Direction,
    ExecutionStatus,
    FileType,
} from '../shared/index.js';
import type {
    ChangesetStatus,
    ChangesetHistoryRecord,
    UnifiedHistoryRecord,
    FileHistoryRecord,
    NeedsRunResult,
} from './types.js';
import type { ChangeType } from '../shared/index.js';

// ─────────────────────────────────────────────────────────────
// History Class
// ─────────────────────────────────────────────────────────────

/**
 * Changeset history tracker.
 *
 * Handles all database operations for changeset execution tracking.
 *
 * @example
 * ```typescript
 * const history = new ChangesetHistory(db, 'production')
 *
 * // Create operation record
 * const opId = await history.createOperation({
 *     name: '2024-01-15-add-users',
 *     direction: 'change',
 *     executedBy: 'Alice <alice@example.com>',
 * })
 *
 * // Record file executions
 * await history.recordFileExecution(opId, {
 *     filepath: '/path/to/001.sql',
 *     checksum: 'abc123',
 *     status: 'success',
 *     durationMs: 42,
 * })
 *
 * // Finalize
 * await history.finalizeOperation(opId, 'success', 'xyz789', 1234)
 * ```
 */
export class ChangesetHistory {

    readonly #db: Kysely<NoormDatabase>;
    readonly #configName: string;

    constructor(db: Kysely<NoormDatabase>, configName: string) {

        this.#db = db;
        this.#configName = configName;

    }

    // ─────────────────────────────────────────────────────────
    // Status Queries
    // ─────────────────────────────────────────────────────────

    /**
     * Get the current status of a changeset.
     *
     * Queries the most recent record with `direction: 'change'` for
     * the changeset. Revert records don't affect change status.
     *
     * @param name - Changeset name
     * @returns Status or null if never run
     */
    async getStatus(name: string): Promise<ChangesetStatus | null> {

        const [record, err] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.changeset)
                .select([
                    'name',
                    'status',
                    'executed_at',
                    'executed_by',
                    'error_message',
                    'checksum',
                ])
                .where('name', '=', name)
                .where('change_type', '=', 'changeset')
                .where('direction', '=', 'change')
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
        );

        if (err) {

            observer.emit('error', {
                source: 'changeset',
                error: err,
                context: { name, operation: 'get-status' },
            });

            return null;

        }

        if (!record) {

            return null;

        }

        // Check for revert (to get revertedAt)
        const [revertRecord] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.changeset)
                .select(['executed_at'])
                .where('name', '=', name)
                .where('change_type', '=', 'changeset')
                .where('direction', '=', 'revert')
                .where('status', '=', 'success')
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
        );

        return {
            name: record.name,
            status: record.status,
            appliedAt: record.executed_at,
            appliedBy: record.executed_by,
            revertedAt: revertRecord?.executed_at ?? null,
            errorMessage: record.error_message || null,
        };

    }

    /**
     * Get status for all changesets.
     *
     * Returns the most recent change record for each unique changeset name.
     *
     * @returns Map of changeset name to status
     */
    async getAllStatuses(): Promise<Map<string, ChangesetStatus>> {

        const statuses = new Map<string, ChangesetStatus>();

        // Get all unique changeset names
        const [records, err] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.changeset)
                .select(['id', 'name', 'status', 'executed_at', 'executed_by', 'error_message'])
                .where('change_type', '=', 'changeset')
                .where('direction', '=', 'change')
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'changeset',
                error: err,
                context: { operation: 'get-all-statuses' },
            });

            return statuses;

        }

        // Group by name, keeping most recent
        for (const record of records) {

            if (!statuses.has(record.name)) {

                statuses.set(record.name, {
                    name: record.name,
                    status: record.status,
                    appliedAt: record.executed_at,
                    appliedBy: record.executed_by,
                    revertedAt: null, // Will be filled in below
                    errorMessage: record.error_message || null,
                });

            }

        }

        // Get revert info for each
        const [reverts] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.changeset)
                .select(['name', 'executed_at'])
                .where('change_type', '=', 'changeset')
                .where('direction', '=', 'revert')
                .where('status', '=', 'success')
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .execute(),
        );

        if (reverts) {

            // Track which ones we've seen
            const seenReverts = new Set<string>();

            for (const revert of reverts) {

                if (!seenReverts.has(revert.name) && statuses.has(revert.name)) {

                    const status = statuses.get(revert.name)!;
                    status.revertedAt = revert.executed_at;
                    seenReverts.add(revert.name);

                }

            }

        }

        return statuses;

    }

    // ─────────────────────────────────────────────────────────
    // Change Detection
    // ─────────────────────────────────────────────────────────

    /**
     * Check if a changeset needs to run.
     *
     * @param name - Changeset name
     * @param checksum - Current checksum of changeset files
     * @param force - Force re-run regardless of status
     * @returns Whether the changeset needs to run and why
     */
    async needsRun(name: string, checksum: string, force: boolean): Promise<NeedsRunResult> {

        // Force always runs
        if (force) {

            return { needsRun: true, reason: 'force' };

        }

        // Get most recent change record
        const [record, err] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.changeset)
                .select(['status', 'checksum'])
                .where('name', '=', name)
                .where('change_type', '=', 'changeset')
                .where('direction', '=', 'change')
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
        );

        if (err) {

            observer.emit('error', {
                source: 'changeset',
                error: err,
                context: { name, operation: 'needs-run-check' },
            });

            // On error, assume needs to run
            return { needsRun: true, reason: 'new' };

        }

        // No previous record - new changeset
        if (!record) {

            return { needsRun: true, reason: 'new' };

        }

        // Previous execution failed - retry
        if (record.status === 'failed') {

            return {
                needsRun: true,
                reason: 'failed',
                previousChecksum: record.checksum,
                previousStatus: record.status,
            };

        }

        // Previous execution was reverted - can re-apply
        if (record.status === 'reverted') {

            return {
                needsRun: true,
                reason: 'reverted',
                previousChecksum: record.checksum,
                previousStatus: record.status,
            };

        }

        // Checksum changed
        if (record.checksum !== checksum) {

            return {
                needsRun: true,
                reason: 'changed',
                previousChecksum: record.checksum,
                previousStatus: record.status,
            };

        }

        // Success and unchanged - skip
        return {
            needsRun: false,
            skipReason: 'already applied',
            previousChecksum: record.checksum,
            previousStatus: record.status,
        };

    }

    /**
     * Check if a changeset can be reverted.
     *
     * @param name - Changeset name
     * @param force - Force revert regardless of status
     * @returns Whether revert is allowed and current status
     */
    async canRevert(
        name: string,
        force: boolean,
    ): Promise<{ canRevert: boolean; reason?: string; status?: OperationStatus }> {

        const status = await this.getStatus(name);

        if (!status) {

            return { canRevert: false, reason: 'not applied' };

        }

        if (force) {

            return { canRevert: true, status: status.status };

        }

        switch (status.status) {

        case 'pending':
            return { canRevert: false, reason: 'not applied yet', status: status.status };

        case 'success':
            return { canRevert: true, status: status.status };

        case 'failed':
            return { canRevert: true, status: status.status };

        case 'reverted':
            return { canRevert: false, reason: 'already reverted', status: status.status };

        default:
            return { canRevert: false, reason: 'unknown status' };

        }

    }

    // ─────────────────────────────────────────────────────────
    // Create Records
    // ─────────────────────────────────────────────────────────

    /**
     * Create a new operation record.
     *
     * @returns The created operation's ID
     */
    async createOperation(data: {
        name: string;
        direction: Direction;
        executedBy: string;
    }): Promise<number> {

        const [result, err] = await attempt(() =>
            this.#db
                .insertInto(NOORM_TABLES.changeset)
                .values({
                    name: data.name,
                    change_type: 'changeset',
                    direction: data.direction,
                    status: 'pending',
                    config_name: this.#configName,
                    executed_by: data.executedBy,
                })
                .returning('id')
                .executeTakeFirstOrThrow(),
        );

        if (err) {

            throw new Error('Failed to create changeset operation record', { cause: err });

        }

        return result.id;

    }

    /**
     * Create pending file records for all files.
     *
     * Creates records upfront so we can mark remaining as skipped on failure.
     */
    async createFileRecords(
        operationId: number,
        files: Array<{
            filepath: string;
            fileType: FileType;
            checksum: string;
        }>,
    ): Promise<void> {

        if (files.length === 0) return;

        const values = files.map((f) => ({
            changeset_id: operationId,
            filepath: f.filepath,
            file_type: f.fileType,
            checksum: f.checksum,
            status: 'pending' as ExecutionStatus,
        }));

        const [, err] = await attempt(() =>
            this.#db.insertInto(NOORM_TABLES.executions).values(values).execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'changeset',
                error: err,
                context: { operationId, operation: 'create-file-records' },
            });

        }

    }

    // ─────────────────────────────────────────────────────────
    // Update Records
    // ─────────────────────────────────────────────────────────

    /**
     * Update a file execution record.
     */
    async updateFileExecution(
        operationId: number,
        filepath: string,
        status: ExecutionStatus,
        durationMs: number,
        errorMessage?: string,
        skipReason?: string,
    ): Promise<void> {

        const [, err] = await attempt(() =>
            this.#db
                .updateTable(NOORM_TABLES.executions)
                .set({
                    status,
                    duration_ms: durationMs,
                    error_message: errorMessage ?? '',
                    skip_reason: skipReason ?? '',
                })
                .where('changeset_id', '=', operationId)
                .where('filepath', '=', filepath)
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'changeset',
                error: err,
                context: { filepath, operation: 'update-file-execution' },
            });

        }

    }

    /**
     * Mark remaining files as skipped after failure.
     */
    async skipRemainingFiles(operationId: number, reason: string): Promise<void> {

        const [, err] = await attempt(() =>
            this.#db
                .updateTable(NOORM_TABLES.executions)
                .set({
                    status: 'skipped',
                    skip_reason: reason,
                })
                .where('changeset_id', '=', operationId)
                .where('status', '=', 'pending')
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'changeset',
                error: err,
                context: { operationId, operation: 'skip-remaining-files' },
            });

        }

    }

    /**
     * Finalize an operation.
     */
    async finalizeOperation(
        operationId: number,
        status: OperationStatus,
        checksum: string,
        durationMs: number,
        errorMessage?: string,
    ): Promise<void> {

        const [, err] = await attempt(() =>
            this.#db
                .updateTable(NOORM_TABLES.changeset)
                .set({
                    status,
                    checksum,
                    duration_ms: durationMs,
                    error_message: errorMessage ?? '',
                })
                .where('id', '=', operationId)
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'changeset',
                error: err,
                context: { operationId, operation: 'finalize-operation' },
            });

        }

    }

    /**
     * Mark the original change record as reverted.
     *
     * Called after successful revert.
     */
    async markAsReverted(name: string): Promise<void> {

        // Find the most recent 'change' record
        const [record] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.changeset)
                .select(['id'])
                .where('name', '=', name)
                .where('change_type', '=', 'changeset')
                .where('direction', '=', 'change')
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
        );

        if (record) {

            await attempt(() =>
                this.#db
                    .updateTable(NOORM_TABLES.changeset)
                    .set({ status: 'reverted' })
                    .where('id', '=', record.id)
                    .execute(),
            );

        }

    }

    // ─────────────────────────────────────────────────────────
    // Delete Records
    // ─────────────────────────────────────────────────────────

    /**
     * Delete all records for a changeset.
     */
    async deleteRecords(name: string): Promise<void> {

        // First get all operation IDs for this changeset
        const [operations, queryErr] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.changeset)
                .select(['id'])
                .where('name', '=', name)
                .where('change_type', '=', 'changeset')
                .where('config_name', '=', this.#configName)
                .execute(),
        );

        if (queryErr || !operations || operations.length === 0) {

            return;

        }

        const operationIds = operations.map((o) => o.id);

        // Delete execution records
        const [, execErr] = await attempt(() =>
            this.#db
                .deleteFrom(NOORM_TABLES.executions)
                .where('changeset_id', 'in', operationIds)
                .execute(),
        );

        if (execErr) {

            observer.emit('error', {
                source: 'changeset',
                error: execErr,
                context: { name, operation: 'delete-executions' },
            });

        }

        // Delete changeset records
        const [, changesetErr] = await attempt(() =>
            this.#db.deleteFrom(NOORM_TABLES.changeset).where('id', 'in', operationIds).execute(),
        );

        if (changesetErr) {

            observer.emit('error', {
                source: 'changeset',
                error: changesetErr,
                context: { name, operation: 'delete-changeset' },
            });

        }

    }

    // ─────────────────────────────────────────────────────────
    // History Queries
    // ─────────────────────────────────────────────────────────

    /**
     * Get execution history for a changeset.
     *
     * @param name - Changeset name (optional, all if not provided)
     * @param limit - Max records to return
     */
    async getHistory(name?: string, limit?: number): Promise<ChangesetHistoryRecord[]> {

        let query = this.#db
            .selectFrom(NOORM_TABLES.changeset)
            .select([
                'id',
                'name',
                'direction',
                'status',
                'executed_at',
                'executed_by',
                'duration_ms',
                'error_message',
                'checksum',
            ])
            .where('change_type', '=', 'changeset')
            .where('config_name', '=', this.#configName)
            .orderBy('id', 'desc');

        if (name) {

            query = query.where('name', '=', name);

        }

        if (limit) {

            query = query.limit(limit);

        }

        const [records, err] = await attempt(() => query.execute());

        if (err) {

            observer.emit('error', {
                source: 'changeset',
                error: err,
                context: { name, operation: 'get-history' },
            });

            return [];

        }

        return records.map((r) => ({
            id: r.id,
            name: r.name,
            direction: r.direction,
            status: r.status,
            executedAt: r.executed_at,
            executedBy: r.executed_by,
            durationMs: r.duration_ms,
            errorMessage: r.error_message || null,
            checksum: r.checksum,
        }));

    }

    /**
     * Get unified execution history across all operation types.
     *
     * Unlike getHistory() which only returns changesets, this returns
     * builds, runs, and changesets in a unified view.
     *
     * @param changeTypes - Optional filter for specific types (default: all)
     * @param limit - Max records to return
     */
    async getUnifiedHistory(
        changeTypes?: ChangeType[],
        limit?: number,
    ): Promise<UnifiedHistoryRecord[]> {

        let query = this.#db
            .selectFrom(NOORM_TABLES.changeset)
            .select([
                'id',
                'name',
                'change_type',
                'direction',
                'status',
                'executed_at',
                'executed_by',
                'duration_ms',
                'error_message',
                'checksum',
            ])
            .where('config_name', '=', this.#configName)
            .orderBy('id', 'desc');

        // Filter by change types if specified
        if (changeTypes && changeTypes.length > 0) {

            query = query.where('change_type', 'in', changeTypes);

        }

        if (limit) {

            query = query.limit(limit);

        }

        const [records, err] = await attempt(() => query.execute());

        if (err) {

            observer.emit('error', {
                source: 'changeset',
                error: err,
                context: { operation: 'get-unified-history' },
            });

            return [];

        }

        return records.map((r) => ({
            id: r.id,
            name: r.name,
            changeType: r.change_type,
            direction: r.direction,
            status: r.status,
            executedAt: r.executed_at,
            executedBy: r.executed_by,
            durationMs: r.duration_ms,
            errorMessage: r.error_message || null,
            checksum: r.checksum,
        }));

    }

    /**
     * Get build and run history only (excludes changesets).
     *
     * Convenience method for screens that want to show only
     * build/run operations.
     *
     * @param limit - Max records to return
     */
    async getBuildRunHistory(limit?: number): Promise<UnifiedHistoryRecord[]> {

        return this.getUnifiedHistory(['build', 'run'], limit);

    }

    /**
     * Get file execution records for an operation.
     */
    async getFileHistory(operationId: number): Promise<FileHistoryRecord[]> {

        const [records, err] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.executions)
                .select([
                    'id',
                    'changeset_id',
                    'filepath',
                    'file_type',
                    'checksum',
                    'status',
                    'skip_reason',
                    'error_message',
                    'duration_ms',
                ])
                .where('changeset_id', '=', operationId)
                .orderBy('id', 'asc')
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'changeset',
                error: err,
                context: { operationId, operation: 'get-file-history' },
            });

            return [];

        }

        return records.map((r) => ({
            id: r.id,
            changesetId: r.changeset_id,
            filepath: r.filepath,
            fileType: r.file_type as 'sql' | 'txt',
            checksum: r.checksum,
            status: r.status,
            skipReason: r.skip_reason || null,
            errorMessage: r.error_message || null,
            durationMs: r.duration_ms,
        }));

    }

    /**
     * Get all orphaned changesets (in DB but not on disk).
     *
     * @param diskNames - Set of changeset names on disk
     */
    async getOrphaned(diskNames: Set<string>): Promise<string[]> {

        const statuses = await this.getAllStatuses();
        const orphaned: string[] = [];

        for (const [name] of statuses) {

            if (!diskNames.has(name)) {

                orphaned.push(name);

            }

        }

        return orphaned;

    }

}
