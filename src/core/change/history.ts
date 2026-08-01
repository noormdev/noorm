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

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import { getNoormTables, insertOperationRecord, noormDb } from '../shared/index.js';
import { getCurrentVersion } from '../update/checker.js';
import type {
    NoormDatabase,
    OperationStatus,
    Direction,
    ExecutionStatus,
    FileType,
} from '../shared/index.js';
import type { Dialect } from '../connection/types.js';
import type {
    ChangeStatus,
    ChangeHistoryRecord,
    UnifiedHistoryRecord,
    FileHistoryRecord,
    NeedsRunResult,
} from './types.js';
import type { ChangeType } from '../shared/index.js';

// ─────────────────────────────────────────────────────────────
// Date Hydration
// ─────────────────────────────────────────────────────────────

/**
 * Reserved change name recording a `db teardown`.
 *
 * Shares the `change` row shape so teardowns appear in the audit trail,
 * which also made it show up in `change list` as a user change that is
 * permanently orphaned — it has no folder on disk and never will.
 * Status reads filter it out; history reads keep it.
 */
const RESET_MARKER = '__reset__';

/**
 * Dialects whose driver parses an offset-less timestamp column in the host's
 * local zone rather than as UTC.
 *
 * WHY: `executed_at` is `timestamp`/`datetime2` — no time zone — and noorm
 * always writes UTC into it. `pg` and `mysql2` both read that naive text back
 * through the local zone, so a row stored at 05:10:57 UTC comes back as a
 * `Date` meaning 05:10:57 local. On a UTC-4 host that is four hours in the
 * future, which surfaces as "in 4 hours" wherever the TUI renders relative
 * time. Both were measured, not assumed.
 *
 * MSSQL is deliberately absent: `tedious` was not measured, and leaving it out
 * keeps its current behavior rather than risking a correction in the wrong
 * direction. SQLite is absent because it returns text and takes the string
 * path below.
 */
const LOCAL_PARSED_TIMESTAMP_DIALECTS: ReadonlySet<Dialect> = new Set(['postgres', 'mysql']);

/**
 * Normalizes a change-tracking timestamp column to a real `Date` in UTC.
 *
 * WHY: the column carries no time zone and noorm writes UTC into it, but every
 * driver disagrees about how to read that back. SQLite (both `bun:sqlite` and
 * `better-sqlite3`) hands back raw `CURRENT_TIMESTAMP` text; `pg` and `mysql2`
 * hand back a `Date` they already misread as local. Both roads lead to the
 * same silent shift by the host's UTC offset, so both are corrected here —
 * the string by marking it UTC, the `Date` by reinterpreting the local
 * calendar fields the driver produced as the UTC fields they actually were.
 *
 * @example
 * hydrateDate('2026-07-12 09:02:59', 'sqlite')   // -> 2026-07-12T09:02:59.000Z
 * hydrateDate(pgDateFor09_02_59, 'postgres')     // -> 2026-07-12T09:02:59.000Z
 * hydrateDate(null, 'postgres')                  // -> null
 */
export function hydrateDate(
    value: Date | string | null | undefined,
    dialect: Dialect,
): Date | null {

    if (value === null || value === undefined) {

        return null;

    }

    if (value instanceof Date) {

        if (!LOCAL_PARSED_TIMESTAMP_DIALECTS.has(dialect)) {

            return value;

        }

        return new Date(Date.UTC(
            value.getFullYear(),
            value.getMonth(),
            value.getDate(),
            value.getHours(),
            value.getMinutes(),
            value.getSeconds(),
            value.getMilliseconds(),
        ));

    }

    return new Date(`${value.replace(' ', 'T')}Z`);

}

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
    readonly #ndb: Kysely<NoormDatabase>;
    readonly #tables: ReturnType<typeof getNoormTables>;
    readonly #configName: string;
    readonly #dialect: Dialect;

    constructor(db: Kysely<NoormDatabase>, configName: string, dialect: Dialect = 'sqlite') {

        this.#db = db;
        this.#ndb = noormDb(db, dialect);
        this.#tables = getNoormTables(dialect);
        this.#configName = configName;
        this.#dialect = dialect;

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
            this.#ndb
                .selectFrom(this.#tables.change)
                .select([
                    'id',
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
            this.#ndb
                .selectFrom(this.#tables.change)
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
            appliedAt: hydrateDate(record.executed_at, this.#dialect),
            appliedBy: record.executed_by,
            revertedAt: hydrateDate(revertRecord?.executed_at, this.#dialect),
            errorMessage: record.error_message || null,
            appliedHistoryId: record.id,
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
            this.#ndb
                .selectFrom(this.#tables.change)
                .select(['id', 'name', 'status', 'executed_at', 'executed_by', 'error_message'])
                .where('change_type', '=', 'change')
                .where('direction', '=', 'change')
                .where('config_name', '=', this.#configName)
                .where('name', '!=', RESET_MARKER)
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
                    appliedAt: hydrateDate(record.executed_at, this.#dialect),
                    appliedBy: record.executed_by,
                    revertedAt: null, // Will be filled in below
                    errorMessage: record.error_message || null,
                    appliedHistoryId: record.id,
                });

            }

        }

        // Get revert info for each
        const [reverts] = await attempt(() =>
            this.#ndb
                .selectFrom(this.#tables.change)
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
                    status.revertedAt = hydrateDate(revert.executed_at, this.#dialect);
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
            this.#ndb
                .selectFrom(this.#tables.change)
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

    /**
     * Check if a single file within a change needs to run.
     *
     * Mirrors `Tracker.needsRun` (runner/tracker.ts) but scoped to this
     * change's name+direction+config instead of a global filepath lookup,
     * so file A's success under one change never satisfies file A's check
     * under a different change.
     *
     * Excludes `pending` rows from consideration: `createFileRecords`
     * inserts a fresh pending row for every file before the per-file loop
     * runs, and that row (always the highest id for this filepath) would
     * otherwise shadow the prior operation's real success/failure record,
     * making retries re-run every file instead of just the one that failed.
     *
     * Also excludes `skipped` rows: `status: 'skipped'` is written for two
     * different meanings — `skipRemainingFiles` writes it for files never
     * reached after an earlier failure (must re-run), while this method's
     * own per-file-skip path (called from `executor.ts`) writes it for a
     * file that matched a prior success (must stay skipped). A `skipped`
     * row is never itself a decision basis: a success-match skip still has
     * its covering `success` row further back in history (found once the
     * `skipped` row is excluded), and a never-reached skip has no terminal
     * row at all, so the lookup falls through to `{ needsRun: true, reason:
     * 'new' }` below and the file runs. Both resolve correctly without
     * consulting the ambiguous row — excluding it here is what prevents a
     * third attempt from re-running a file a prior success already covered.
     *
     * A prior success only licenses a skip while it is still *standing*.
     * Two things retire it, and neither is visible on the execution row
     * itself, so both are filtered on the parent operation:
     *
     * 1. The operation was reverted or torn down. `markAsReverted` and
     *    `markAllAsStale` flip the forward operation's status to
     *    `reverted`/`stale`, so its file successes no longer describe
     *    anything that exists in the database.
     * 2. An operation in the opposite direction has run since. A revert
     *    undoes a prior apply and an apply undoes a prior revert, but
     *    neither rewrites the other's rows — only their relative order
     *    says which one is still in effect. Hence the `id` boundary.
     *
     * Without both, each file executes at most once per direction for the
     * lifetime of the tracking table and every apply->revert->apply cycle
     * silently no-ops.
     *
     * @param name - Change name
     * @param direction - 'change' or 'revert'
     * @param filepath - Relative filepath as stored in execution records
     * @param checksum - Current checksum of the file
     * @param force - Force re-run regardless of status
     * @returns Whether the file needs to run and why
     */
    async needsRunFile(
        name: string,
        direction: Direction,
        filepath: string,
        checksum: string,
        force: boolean,
    ): Promise<NeedsRunResult> {

        // Force always runs
        if (force) {

            return { needsRun: true, reason: 'force' };

        }

        const opposite: Direction = direction === 'change' ? 'revert' : 'change';

        // Newest operation that ran the other way; anything at or before it
        // has since been undone.
        const [boundary, boundaryErr] = await attempt(() =>
            this.#ndb
                .selectFrom(this.#tables.change)
                .select(['id'])
                .where('name', '=', name)
                .where('change_type', '=', 'change')
                .where('direction', '=', opposite)
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
        );

        if (boundaryErr) {

            observer.emit('error', {
                source: 'change',
                error: boundaryErr,
                context: { name, filepath, operation: 'needs-run-file-boundary' },
            });

            // Can't prove the prior success still stands, so re-run rather
            // than skip: a redundant run is recoverable, a skipped one is not.
            return { needsRun: true, reason: 'new' };

        }

        // Get most recent completed execution record for this file, scoped
        // to this change's name+direction+config
        const [record, err] = await attempt(() => {

            let query = (this.#ndb
                .selectFrom(this.#tables.executions)
                .innerJoin(
                    this.#tables.change,
                    `${this.#tables.change}.id`,
                    `${this.#tables.executions}.change_id`,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ) as any)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .select((eb: any) => [
                    eb.ref(`${this.#tables.executions}.checksum`).as('checksum'),
                    eb.ref(`${this.#tables.executions}.status`).as('exec_status'),
                ])
                .where(`${this.#tables.change}.name`, '=', name)
                .where(`${this.#tables.change}.direction`, '=', direction)
                .where(`${this.#tables.change}.config_name`, '=', this.#configName)
                .where(`${this.#tables.change}.status`, 'not in', ['reverted', 'stale'])
                .where(`${this.#tables.executions}.filepath`, '=', filepath)
                .where(`${this.#tables.executions}.status`, 'not in', ['pending', 'skipped']);

            if (boundary) {

                query = query.where(`${this.#tables.change}.id`, '>', boundary.id);

            }

            return query
                .orderBy(`${this.#tables.executions}.id`, 'desc')
                .limit(1)
                .executeTakeFirst();

        });

        if (err) {

            observer.emit('error', {
                source: 'change',
                error: err,
                context: { name, filepath, operation: 'needs-run-file-check' },
            });

            // On error, assume needs to run
            return { needsRun: true, reason: 'new' };

        }

        // No previous completed record - new file
        if (!record) {

            return { needsRun: true, reason: 'new' };

        }

        // Previous execution failed - retry
        if (record.exec_status === 'failed') {

            return {
                needsRun: true,
                reason: 'failed',
                previousChecksum: record.checksum,
            };

        }

        // Checksum changed since the last recorded attempt
        if (record.checksum !== checksum) {

            return {
                needsRun: true,
                reason: 'changed',
                previousChecksum: record.checksum,
            };

        }

        // Success and unchanged - skip
        return {
            needsRun: false,
            skipReason: 'already applied',
            previousChecksum: record.checksum,
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

        const [id, insertErr] = await insertOperationRecord({
            db: this.#db,
            ndb: this.#ndb,
            dialect: this.#dialect,
            table: this.#tables.change,
            values: {
                name: data.name,
                change_type: 'change',
                direction: data.direction,
                status: 'pending',
                config_name: this.#configName,
                executed_by: data.executedBy,
                cli_version: getCurrentVersion(),
            },
        });

        if (insertErr) {

            throw new Error('Failed to create change operation record', { cause: insertErr });

        }

        if (id === undefined) {

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
            this.#ndb.insertInto(this.#tables.executions).values(values).execute(),
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
            this.#ndb
                .updateTable(this.#tables.executions)
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
            this.#ndb
                .updateTable(this.#tables.executions)
                .set({
                    status: 'skipped',
                    skip_reason: reason.slice(0, 100),
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
            this.#ndb
                .updateTable(this.#tables.change)
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

        const [id, insertErr] = await insertOperationRecord({
            db: this.#db,
            ndb: this.#ndb,
            dialect: this.#dialect,
            table: this.#tables.change,
            values: {
                name: RESET_MARKER,
                change_type: 'change',
                direction: 'change',
                status: 'success',
                config_name: this.#configName,
                executed_by: executedBy,
                cli_version: getCurrentVersion(),
                error_message: reason ?? '',
                duration_ms: 0,
                checksum: '',
            },
        });

        // A teardown that happened must not be undone by a failure to write
        // its audit row, so this degrades to 0 rather than throwing.
        if (insertErr) {

            observer.emit('error', {
                source: 'change',
                error: insertErr,
                context: { operation: 'record-reset' },
            });

            return 0;

        }

        return id ?? 0;

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
            this.#ndb
                .selectFrom(this.#tables.change)
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
            this.#ndb
                .deleteFrom(this.#tables.executions)
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
            this.#ndb.deleteFrom(this.#tables.change).where('id', 'in', operationIds).execute(),
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

        let query = this.#ndb
            .selectFrom(this.#tables.change)
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
            // Non-null: executed_at is NOT NULL with a CURRENT_TIMESTAMP
            // default, always populated on write (see createOperation).
            executedAt: hydrateDate(r.executed_at, this.#dialect)!,
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

        let query = this.#ndb
            .selectFrom(this.#tables.change)
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
            // Non-null: executed_at is NOT NULL with a CURRENT_TIMESTAMP
            // default, always populated on write (see createOperation).
            executedAt: hydrateDate(r.executed_at, this.#dialect)!,
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
            this.#ndb
                .selectFrom(this.#tables.executions)
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
