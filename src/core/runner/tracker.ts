/**
 * Execution tracker.
 *
 * Manages database records for tracking SQL file executions.
 * Provides change detection by comparing checksums against
 * previous executions.
 *
 * WHY: Idempotent builds require knowing which files have changed.
 * The tracker maintains an audit trail in __noorm_change__ and
 * __noorm_executions__ tables.
 *
 * @example
 * ```typescript
 * import { Tracker } from './tracker'
 *
 * const tracker = new Tracker(db, 'dev')
 *
 * // Decide every file of a batch from one prefetch
 * const [latest, err] = await tracker.latestExecutions()
 * const result = decideNeedsRun(err ?? latest.get('sql/001.sql'), 'abc123', false)
 *
 * // Create operation and pending rows, then record each outcome
 * const opId = await tracker.createOperation({ name: 'build:...', ... })
 * await tracker.createFileRecords(opId, [{ filepath: '...', fileType: 'sql', checksum: '...' }])
 * await tracker.updateFileExecution(opId, '...', 'success', 42)
 * ```
 */
import type { Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import { getNoormTables, insertOperationRecord, noormDb } from '../shared/index.js';
import type { NoormDatabase, ChangeType, ExecutionStatus, FileType } from '../shared/index.js';
import type { Dialect } from '../connection/types.js';
import type { NeedsRunResult, CreateOperationData, Direction, ExecutionRecord } from './types.js';

/**
 * Decide whether a file must run, given its newest execution record.
 *
 * @param record - Newest execution record, `undefined` when the file never ran, or the lookup error
 * @param checksum - Current file checksum
 * @param force - Force re-run regardless of history
 * @returns Whether the file needs to run and why
 *
 * @example
 * ```typescript
 * const [latest, err] = await tracker.latestExecutions()
 * const result = decideNeedsRun(err ?? latest.get('sql/001.sql'), checksum, false)
 * ```
 */
export function decideNeedsRun(
    record: ExecutionRecord | Error | undefined,
    checksum: string,
    force: boolean,
): NeedsRunResult {

    if (force) {

        return { needsRun: true, reason: 'force' };

    }

    // Distinct from 'new': the SELECT itself failed, so whether a
    // record exists is genuinely unknown. Reporting this as 'new'
    // would make a transient read failure indistinguishable from a
    // first-ever run in logs and audits.
    if (record instanceof Error) {

        return { needsRun: true, reason: 'error' };

    }

    if (!record) {

        return { needsRun: true, reason: 'new' };

    }

    if (record.exec_status === 'failed') {

        return {
            needsRun: true,
            reason: 'failed',
            previousChecksum: record.checksum,
        };

    }

    // A `pending` row belongs to a file its batch never reached, so it
    // carries no outcome to compare against and must run.
    //
    // A cascade `skipped` row never executed either. An `unchanged` skip (older
    // builds only) recorded a real skip, so fall through and re-compare the checksum.
    const isUnchangedSkip = record.exec_status === 'skipped' && record.skip_reason === 'unchanged';

    if (record.exec_status === 'pending' || (record.exec_status === 'skipped' && !isUnchangedSkip)) {

        return { needsRun: true, reason: 'new' };

    }

    if (record.change_status === 'stale') {

        return {
            needsRun: true,
            reason: 'stale',
            previousChecksum: record.checksum,
        };

    }

    if (record.checksum !== checksum) {

        return {
            needsRun: true,
            reason: 'changed',
            previousChecksum: record.checksum,
        };

    }

    return {
        needsRun: false,
        skipReason: 'unchanged',
        previousChecksum: record.checksum,
    };

}

/**
 * Execution tracker for change detection and audit logging.
 *
 * @example
 * ```typescript
 * const tracker = new Tracker(db, 'production')
 *
 * // Start a build operation
 * const opId = await tracker.createOperation({
 *     name: 'build:2024-01-15T10:30:00',
 *     changeType: 'build',
 *     configName: 'production',
 *     executedBy: 'Alice <alice@example.com>',
 * })
 *
 * // Seed a pending row per file, then record each outcome
 * await tracker.createFileRecords(opId, [
 *     { filepath: 'sql/001.sql', fileType: 'sql', checksum: 'abc123...' },
 * ])
 * await tracker.updateFileExecution(opId, 'sql/001.sql', 'success', 42)
 *
 * // Finalize the operation
 * await tracker.finalizeOperation(opId, 'success', 1234)
 * ```
 */
export class Tracker {

    readonly #db: Kysely<NoormDatabase>;
    readonly #ndb: Kysely<NoormDatabase>;
    readonly #tables: ReturnType<typeof getNoormTables>;
    readonly #configName: string;
    readonly #dialect: Dialect;

    constructor(db: Kysely<NoormDatabase>, configName: string, dialect: Dialect) {

        this.#db = db;
        this.#ndb = noormDb(db, dialect);
        this.#tables = getNoormTables(dialect);
        this.#configName = configName;
        this.#dialect = dialect;

    }

    /**
     * Fetch the newest execution row per filepath for this config.
     *
     * One SELECT for any number of files, so a batch can decide every file
     * with `decideNeedsRun` before writing any tracking rows. Query form:
     * `docs/design/prefetch-run-gate.md`.
     *
     * @returns Map of filepath to its newest record, or the lookup error
     *
     * @example
     * ```typescript
     * const [latest, err] = await tracker.latestExecutions()
     * const result = decideNeedsRun(err ?? latest.get(filepath), checksum, false)
     * ```
     */
    async latestExecutions(): Promise<[Map<string, ExecutionRecord>, null] | [null, Error]> {

        const { executions, change } = this.#tables;

        const newestIds = (this.#ndb
            .selectFrom(executions)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .innerJoin(change, `${change}.id`, `${executions}.change_id`) as any)
            .where(`${change}.config_name`, '=', this.#configName)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .select((eb: any) => eb.fn.max(`${executions}.id`).as('id'))
            .groupBy(`${executions}.filepath`)
            .as('newest');

        const [rows, err] = await attempt(() =>
            (this.#ndb
                .selectFrom(executions)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .innerJoin(change, `${change}.id`, `${executions}.change_id`) as any)
                .innerJoin(newestIds, 'newest.id', `${executions}.id`)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .select((eb: any) => [
                    eb.ref(`${executions}.filepath`).as('filepath'),
                    eb.ref(`${executions}.checksum`).as('checksum'),
                    eb.ref(`${executions}.status`).as('exec_status'),
                    eb.ref(`${executions}.skip_reason`).as('skip_reason'),
                    eb.ref(`${change}.status`).as('change_status'),
                ])
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'runner',
                error: err,
                context: { operation: 'latest-executions' },
            });

            return [null, err];

        }

        const latest = new Map<string, ExecutionRecord>();

        for (const { filepath, ...record } of rows) {

            latest.set(filepath, record);

        }

        return [latest, null];

    }

    /**
     * Create a new operation record.
     *
     * Operations are parent records in __noorm_change__ that
     * group individual file executions.
     *
     * @param data - Operation data
     * @returns The created operation's ID
     */
    async createOperation(data: CreateOperationData): Promise<number> {

        // Direction defaults to 'commit' (forward execution)
        const direction: Direction = data.direction ?? 'commit';

        // Map direction to database value
        // 'commit' is stored as 'change' for historical compatibility
        const dbDirection = direction === 'commit' ? 'change' : 'revert';

        const [id, insertErr] = await insertOperationRecord({
            db: this.#db,
            ndb: this.#ndb,
            dialect: this.#dialect,
            table: this.#tables.change,
            values: {
                name: data.name,
                change_type: data.changeType as ChangeType,
                direction: dbDirection,
                status: 'pending',
                config_name: data.configName,
                executed_by: data.executedBy,
            },
        });

        if (insertErr) {

            throw new Error('Failed to create operation record', { cause: insertErr });

        }

        if (id === undefined) {

            throw new Error(`Invalid operation ID returned: ${id}`);

        }

        return id;

    }

    /**
     * Finalize an operation.
     *
     * Updates the parent record with final status and duration.
     *
     * @param operationId - Operation ID to update
     * @param status - Final status
     * @param durationMs - Total duration
     * @param checksum - Combined checksum of all files
     * @param errorMessage - Error message if failed
     * @returns Error message if finalization failed, null on success
     */
    async finalizeOperation(
        operationId: number,
        status: 'success' | 'failed',
        durationMs: number,
        checksum?: string,
        errorMessage?: string,
    ): Promise<string | null> {

        // Truncate error message if too long (some DBs have limits)
        const truncatedError = errorMessage ? errorMessage.slice(0, 2000) : '';

        const [result, err] = await attempt(() =>
            this.#ndb
                .updateTable(this.#tables.change)
                .set({
                    status,
                    duration_ms: Math.round(durationMs),
                    checksum: checksum ?? '',
                    error_message: truncatedError,
                })
                .where('id', '=', operationId)
                .executeTakeFirst(),
        );

        if (err) {

            const errMsg = err instanceof Error ? err.message : String(err);

            observer.emit('error', {
                source: 'runner',
                error: err,
                context: { operationId, operation: 'finalize-operation' },
            });

            return `Failed to finalize operation ${operationId}: ${errMsg}`;

        }

        // Check if any rows were updated
        const numUpdated = Number(result?.numUpdatedRows ?? 0);

        if (numUpdated === 0) {

            const errMsg = `No operation record found with id ${operationId}`;

            observer.emit('error', {
                source: 'runner',
                error: new Error(errMsg),
                context: { operationId, operation: 'finalize-operation' },
            });

            return errMsg;

        }

        return null;

    }

    // ─────────────────────────────────────────────────────────
    // Batch File Operations (Shared by Runner and Changes)
    // ─────────────────────────────────────────────────────────

    /**
     * Create pending file records for the files about to run.
     *
     * The pending rows let `skipRemainingFiles` mark the files a
     * failure left unreached.
     *
     * @param operationId - Parent operation ID
     * @param files - Files to create records for
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
                source: 'runner',
                error: err,
                context: { operationId, operation: 'create-file-records' },
            });

            return `Failed to create file records: ${errMsg}`;

        }

        return null;

    }

    /**
     * Update a file execution record.
     *
     * Updates an existing pending record with execution results.
     *
     * @param operationId - Parent operation ID
     * @param filepath - File path to update
     * @param status - Execution status
     * @param durationMs - Execution time
     * @param errorMessage - Error message if failed
     * @param skipReason - Skip reason if skipped
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
                source: 'runner',
                error: err,
                context: { filepath, operation: 'update-file-execution' },
            });

            return `Failed to update file execution ${filepath}: ${errMsg}`;

        }

        // Exactly one row must match. Zero means the pending record is
        // missing; more than one means (change_id, filepath) isn't unique --
        // exactly the shape a duplicate discovered file would take, and
        // tolerating it here would silently update N rows and mask the
        // duplicate from ever surfacing.
        const numUpdated = Number(result?.numUpdatedRows ?? 0);

        if (numUpdated !== 1) {

            const errMsg = numUpdated === 0
                ? `No execution record found for ${filepath} (operationId: ${operationId})`
                : `Expected exactly 1 execution record for ${filepath} (operationId: ${operationId}), matched ${numUpdated}`;

            observer.emit('error', {
                source: 'runner',
                error: new Error(errMsg),
                context: { operationId, filepath, operation: 'update-file-execution' },
            });

            return errMsg;

        }

        return null;

    }

    /**
     * Find prior successful executions of a file, most recent first.
     *
     * Called on the failure path only. A file that fails after a history of
     * clean runs at this config rules out a broken file and points instead
     * at drift between what the tracker expects and what the target
     * database actually has — the detail that would have answered #54
     * immediately instead of reading as intermittent double execution.
     *
     * @param filepath - File path to check (relative, as stored)
     * @param excludeOperationId - Omit rows belonging to the operation
     * currently running, so a failure doesn't cite itself as history.
     */
    async priorSuccessfulExecutions(
        filepath: string,
        excludeOperationId?: number,
    ): Promise<Array<{ operationName: string; operationId: number }>> {

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
                eb.ref(`${this.#tables.change}.name`).as('operationName'),
                eb.ref(`${this.#tables.executions}.change_id`).as('operationId'),
            ])
            .where(`${this.#tables.executions}.filepath`, '=', filepath)
            .where(`${this.#tables.executions}.status`, '=', 'success')
            .where(`${this.#tables.change}.config_name`, '=', this.#configName);

        if (excludeOperationId !== undefined) {

            query = query.where(`${this.#tables.executions}.change_id`, '<>', excludeOperationId);

        }

        const [rows, err] = await attempt(() =>
            query.orderBy(`${this.#tables.executions}.id`, 'desc').execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'runner',
                error: err,
                context: { filepath, operation: 'prior-successful-executions' },
            });

            return [];

        }

        return rows ?? [];

    }

    /**
     * Mark remaining pending files as skipped.
     *
     * Called when execution stops early (failure or abort).
     * Updates all pending records for this operation to skipped.
     *
     * @param operationId - Parent operation ID
     * @param reason - Why files were skipped
     * @returns Error message if skip failed, null on success
     */
    async skipRemainingFiles(operationId: number, reason: string): Promise<string | null> {

        const truncatedReason = reason.slice(0, 100);

        const [, err] = await attempt(() =>
            this.#ndb
                .updateTable(this.#tables.executions)
                .set({
                    status: 'skipped',
                    skip_reason: truncatedReason,
                })
                .where('change_id', '=', operationId)
                .where('status', '=', 'pending')
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'runner',
                error: err,
                context: { operationId, operation: 'skip-remaining-files' },
            });

            return `Failed to skip remaining files: ${err instanceof Error ? err.message : String(err)}`;

        }

        return null;

    }

    /**
     * Check if a change needs to run by name.
     *
     * Used for change sets where we track by change name, not individual files.
     *
     * @param name - Change name
     * @param checksum - Current checksum of change files
     * @param force - Force re-run regardless of status
     * @returns Whether the change needs to run and why
     */
    async needsRunByName(name: string, checksum: string, force: boolean): Promise<NeedsRunResult> {

        // Force always runs
        if (force) {

            return { needsRun: true, reason: 'force' };

        }

        // Get most recent change record for this name
        // Note: Database stores 'change' for forward direction (legacy naming)
        const [record, err] = await attempt(() =>
            this.#ndb
                .selectFrom(this.#tables.change)
                .select(['status', 'checksum'])
                .where('name', '=', name)
                .where('direction', '=', 'change') // 'change' = forward/commit in DB
                .where('config_name', '=', this.#configName)
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
        );

        if (err) {

            observer.emit('error', {
                source: 'runner',
                error: err,
                context: { name, operation: 'needs-run-by-name' },
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
            };

        }

        // Previous execution was reverted - can re-apply
        if (record.status === 'reverted') {

            return {
                needsRun: true,
                reason: 'stale', // Use 'stale' since 'reverted' isn't in RunReason
                previousChecksum: record.checksum,
            };

        }

        // Previous execution is stale (schema torn down) - needs re-apply
        if (record.status === 'stale') {

            return {
                needsRun: true,
                reason: 'stale',
                previousChecksum: record.checksum,
            };

        }

        // Checksum changed
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
            skipReason: 'already-run',
            previousChecksum: record.checksum,
        };

    }

}
