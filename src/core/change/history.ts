/**
 * Change history tracking.
 *
 * Database operations for tracking change execution. Provides
 * change detection, status queries, and execution recording.
 *
 * WHY: Change execution must be tracked to enable:
 * - Idempotent execution (skip already-applied changes)
 * - Audit trail (who ran what, when)
 * - Status visibility (list command)
 * - Safe reverts (know what was applied)
 *
 * @example
 * ```typescript
 * import { ChangeHistory } from './history'
 *
 * const history = new ChangeHistory(db, 'production')
 *
 * // Check if change needs to run
 * const result = await history.needsRun('2024-01-15-add-users', 'abc123...')
 *
 * // Get status
 * const status = await history.getStatus('2024-01-15-add-users')
 * ```
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

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
    ChangeStatus,
    ChangeHistoryRecord,
    UnifiedHistoryRecord,
    FileHistoryRecord,
    NeedsRunResult,
} from './types.js';
import type { ChangeType } from '../shared/index.js';

// ─────────────────────────────────────────────────────────────
// History Class
// ─────────────────────────────────────────────────────────────

/**
 * Change history tracker.
 *
 * Handles all database operations for change execution tracking.
 *
 * @example
 * ```typescript
 * const history = new ChangeHistory(db, 'production')
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
export class ChangeHistory {

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
     * Get the current status of a change.
     *
     * Queries the most recent record with `direction: 'change'` for
     * the change. Revert records don't affect change status.
     *
     * @param name - Change name
     * @returns Status or null if never run
     */
    async getStatus(name: string): Promise<ChangeStatus | null> {

        const [record, err] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.change)
                .select([
                    'name',
                    'status',
                    'executed_at',
                    'executed_by',
                    'error_message',
                    'checksum',
                ])
                .where('name', '=', name)
                .where('change_type', '=', 'change')
                .where('direction', '=', 'change')
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
        );

        if (err) {

            observer.emit('error', {
                source: 'change',
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
                .selectFrom(NOORM_TABLES.change)
                .select(['executed_at'])
                .where('name', '=', name)
                .where('change_type', '=', 'change')
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
     * Get status for all changes.
     *
     * Returns the most recent change record for each unique change name.
     *
     * @returns Map of change name to status
     */
    async getAllStatuses(): Promise<Map<string, ChangeStatus>> {

        const statuses = new Map<string, ChangeStatus>();

        // Get all unique change names
        const [records, err] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.change)
                .select(['id', 'name', 'status', 'executed_at', 'executed_by', 'error_message'])
                .where('change_type', '=', 'change')
                .where('direction', '=', 'change')
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'change',
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
                .selectFrom(NOORM_TABLES.change)
                .select(['name', 'executed_at'])
                .where('change_type', '=', 'change')
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
     * Check if a change needs to run.
     *
     * @param name - Change name
     * @param checksum - Current checksum of change files
     * @param force - Force re-run regardless of status
     * @returns Whether the change needs to run and why
     */
    async needsRun(name: string, checksum: string, force: boolean): Promise<NeedsRunResult> {

        // Force always runs
        if (force) {

            return { needsRun: true, reason: 'force' };

        }

        // Get most recent change record
        const [record, err] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.change)
                .select(['status', 'checksum'])
                .where('name', '=', name)
                .where('change_type', '=', 'change')
                .where('direction', '=', 'change')
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
        );

        if (err) {

            observer.emit('error', {
                source: 'change',
                error: err,
                context: { name, operation: 'needs-run-check' },
            });

            // On error, assume needs to run
            return { needsRun: true, reason: 'new' };

        }

        // No previous record - new change
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

        // Previous execution is stale (schema torn down) - needs re-apply
        if (record.status === 'stale') {

            return {
                needsRun: true,
                reason: 'stale',
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

    // ─────────────────────────────────────────────────────────
    // Create Records
    // ─────────────────────────────────────────────────────────
    //
    // NOTE: canRevert has been moved to ChangeTracker.
    //

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
                .insertInto(NOORM_TABLES.change)
                .values({
                    name: data.name,
                    change_type: 'change',
                    direction: data.direction,
                    status: 'pending',
                    config_name: this.#configName,
                    executed_by: data.executedBy,
                })
                .returning('id')
                .executeTakeFirstOrThrow(),
        );

        if (err) {

            throw new Error('Failed to create change operation record', { cause: err });

        }

        // Validate the returned ID
        // Note: SQLite with better-sqlite3 may return null for RETURNING clause
        // In that case, fall back to last_insert_rowid()
        let id = result?.id;

        if (id === null || id === undefined) {

            const [lastIdResult, lastIdErr] = await attempt(() =>
                sql<{ id: number }>`SELECT last_insert_rowid() as id`.execute(this.#db),
            );

            if (lastIdErr || !lastIdResult?.rows?.[0]?.id) {

                throw new Error('Failed to retrieve last insert row id');

            }

            id = lastIdResult.rows[0].id;

        }

        if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) {

            throw new Error(`Invalid operation ID returned: ${id}`);

        }

        return id;

    }

    /**
     * Create pending file records for all files.
     *
     * Creates records upfront so we can mark remaining as skipped on failure.
     *
     * @returns Error message if creation failed, null on success
     */
    async createFileRecords(
        operationId: number,
        files: Array<{
            filepath: string;
            fileType: FileType;
            checksum: string;
        }>,
    ): Promise<string | null> {

        if (files.length === 0) return null;

        const values = files.map((f) => ({
            change_id: operationId,
            filepath: f.filepath,
            file_type: f.fileType,
            checksum: f.checksum,
            status: 'pending' as ExecutionStatus,
        }));

        const [, err] = await attempt(() =>
            this.#db.insertInto(NOORM_TABLES.executions).values(values).execute(),
        );

        if (err) {

            const errMsg = err instanceof Error ? err.message : String(err);

            observer.emit('error', {
                source: 'change',
                error: err,
                context: { operationId, operation: 'create-file-records' },
            });

            return `Failed to create file records: ${errMsg}`;

        }

        return null;

    }

    // ─────────────────────────────────────────────────────────
    // Update Records
    // ─────────────────────────────────────────────────────────

    /**
     * Update a file execution record.
     *
     * @returns Error message if update failed, null on success
     */
    async updateFileExecution(
        operationId: number,
        filepath: string,
        status: ExecutionStatus,
        durationMs: number,
        errorMessage?: string,
        skipReason?: string,
    ): Promise<string | null> {

        const [result, err] = await attempt(() =>
            this.#db
                .updateTable(NOORM_TABLES.executions)
                .set({
                    status,
                    duration_ms: Math.round(durationMs),
                    error_message: errorMessage ?? '',
                    skip_reason: skipReason ?? '',
                })
                .where('change_id', '=', operationId)
                .where('filepath', '=', filepath)
                .executeTakeFirst(),
        );

        if (err) {

            const errMsg = err instanceof Error ? err.message : String(err);

            observer.emit('error', {
                source: 'change',
                error: err,
                context: { filepath, operation: 'update-file-execution' },
            });

            return `Failed to update file execution ${filepath}: ${errMsg}`;

        }

        // Check if any rows were updated
        const numUpdated = Number(result?.numUpdatedRows ?? 0);

        if (numUpdated === 0) {

            const errMsg = `No execution record found for ${filepath} (operationId: ${operationId})`;

            observer.emit('error', {
                source: 'change',
                error: new Error(errMsg),
                context: { operationId, filepath, operation: 'update-file-execution' },
            });

            return errMsg;

        }

        return null;

    }

    /**
     * Mark remaining files as skipped after failure.
     *
     * @returns Error message if skip failed, null on success
     */
    async skipRemainingFiles(operationId: number, reason: string): Promise<string | null> {

        const [, err] = await attempt(() =>
            this.#db
                .updateTable(NOORM_TABLES.executions)
                .set({
                    status: 'skipped',
                    skip_reason: reason,
                })
                .where('change_id', '=', operationId)
                .where('status', '=', 'pending')
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'change',
                error: err,
                context: { operationId, operation: 'skip-remaining-files' },
            });

            return `Failed to skip remaining files: ${err instanceof Error ? err.message : String(err)}`;

        }

        return null;

    }

    /**
     * Finalize an operation.
     *
     * @returns Error message if finalization failed, null on success
     */
    async finalizeOperation(
        operationId: number,
        status: OperationStatus,
        checksum: string,
        durationMs: number,
        errorMessage?: string,
    ): Promise<string | null> {

        // Truncate error message if too long (some DBs have limits)
        const truncatedError = errorMessage ? errorMessage.slice(0, 2000) : '';

        const [result, err] = await attempt(() =>
            this.#db
                .updateTable(NOORM_TABLES.change)
                .set({
                    status,
                    checksum,
                    duration_ms: Math.round(durationMs),
                    error_message: truncatedError,
                })
                .where('id', '=', operationId)
                .executeTakeFirst(),
        );

        if (err) {

            const errMsg = err instanceof Error ? err.message : String(err);

            observer.emit('error', {
                source: 'change',
                error: err,
                context: { operationId, operation: 'finalize-operation' },
            });

            // Return error instead of throwing - let caller decide how to handle
            return `Failed to finalize operation ${operationId}: ${errMsg}`;

        }

        // Check if any rows were updated
        const numUpdated = Number(result?.numUpdatedRows ?? 0);

        if (numUpdated === 0) {

            const errMsg = `No operation record found with id ${operationId}`;

            observer.emit('error', {
                source: 'change',
                error: new Error(errMsg),
                context: { operationId, operation: 'finalize-operation' },
            });

            return errMsg;

        }

        return null;

    }

    // NOTE: markAsReverted and markAllAsStale have been moved to ChangeTracker.

    /**
     * Record a database reset event.
     *
     * Creates a special change entry to document when the database
     * was torn down. Provides audit trail for reset operations.
     *
     * @param executedBy - Identity of who performed the reset
     * @param reason - Optional reason for the reset
     * @returns The created record's ID
     */
    async recordReset(executedBy: string, reason?: string): Promise<number> {

        const [result, err] = await attempt(() =>
            this.#db
                .insertInto(NOORM_TABLES.change)
                .values({
                    name: '__reset__',
                    change_type: 'change',
                    direction: 'change',
                    status: 'success',
                    config_name: this.#configName,
                    executed_by: executedBy,
                    error_message: reason ?? '',
                    duration_ms: 0,
                    checksum: '',
                })
                .returning('id')
                .executeTakeFirstOrThrow(),
        );

        if (err) {

            observer.emit('error', {
                source: 'change',
                error: err,
                context: { operation: 'record-reset' },
            });

            return 0;

        }

        return result.id;

    }

    // ─────────────────────────────────────────────────────────
    // Delete Records
    // ─────────────────────────────────────────────────────────

    /**
     * Delete all records for a change.
     */
    async deleteRecords(name: string): Promise<void> {

        // First get all operation IDs for this change
        const [operations, queryErr] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.change)
                .select(['id'])
                .where('name', '=', name)
                .where('change_type', '=', 'change')
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
                .where('change_id', 'in', operationIds)
                .execute(),
        );

        if (execErr) {

            observer.emit('error', {
                source: 'change',
                error: execErr,
                context: { name, operation: 'delete-executions' },
            });

        }

        // Delete change records
        const [, changeErr] = await attempt(() =>
            this.#db.deleteFrom(NOORM_TABLES.change).where('id', 'in', operationIds).execute(),
        );

        if (changeErr) {

            observer.emit('error', {
                source: 'change',
                error: changeErr,
                context: { name, operation: 'delete-change' },
            });

        }

    }

    // ─────────────────────────────────────────────────────────
    // History Queries
    // ─────────────────────────────────────────────────────────

    /**
     * Get execution history for a change.
     *
     * @param name - Change name (optional, all if not provided)
     * @param limit - Max records to return
     */
    async getHistory(name?: string, limit?: number): Promise<ChangeHistoryRecord[]> {

        let query = this.#db
            .selectFrom(NOORM_TABLES.change)
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
            .where('change_type', '=', 'change')
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
                source: 'change',
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
     * Unlike getHistory() which only returns changes, this returns
     * builds, runs, and changes in a unified view.
     *
     * @param changeTypes - Optional filter for specific types (default: all)
     * @param limit - Max records to return
     */
    async getUnifiedHistory(
        changeTypes?: ChangeType[],
        limit?: number,
    ): Promise<UnifiedHistoryRecord[]> {

        let query = this.#db
            .selectFrom(NOORM_TABLES.change)
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
                source: 'change',
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
     * Get build and run history only (excludes changes).
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
                    'change_id',
                    'filepath',
                    'file_type',
                    'checksum',
                    'status',
                    'skip_reason',
                    'error_message',
                    'duration_ms',
                ])
                .where('change_id', '=', operationId)
                .orderBy('id', 'asc')
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'change',
                error: err,
                context: { operationId, operation: 'get-file-history' },
            });

            return [];

        }

        return records.map((r) => ({
            id: r.id,
            changeId: r.change_id,
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
     * Get all orphaned changes (in DB but not on disk).
     *
     * @param diskNames - Set of change names on disk
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
