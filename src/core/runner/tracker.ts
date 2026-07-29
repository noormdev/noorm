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
 * // Check if file needs to run
 * const result = await tracker.needsRun('/path/to/file.sql', 'abc123', false)
 *
 * // Create operation and record executions
 * const opId = await tracker.createOperation({ name: 'build:...', ... })
 * await tracker.recordExecution({ changeId: opId, filepath: '...', ... })
 * ```
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import { getNoormTables, noormDb } from '../shared/index.js';
import type { NoormDatabase, ChangeType, ExecutionStatus, FileType } from '../shared/index.js';
import type { Dialect } from '../connection/types.js';
import type { NeedsRunResult, CreateOperationData, RecordExecutionData, Direction } from './types.js';

/**
 * Coerce a driver-reported generated key into a plain positive integer.
 *
 * Every dialect reports it differently — mysql2 hands back a `bigint`,
 * node-postgres renders `lastval()`'s int8 as a string, mssql and sqlite
 * give a number. Returning `undefined` for anything unusable lets the caller
 * fall through to its next strategy instead of carrying a `bigint` or a
 * numeric string into a column that later rows join against.
 *
 * @example
 * toOperationId(42n); // 42
 * toOperationId('7'); // 7
 * toOperationId(null); // undefined
 */
function toOperationId(value: unknown): number | undefined {

    if (value === null || value === undefined) return undefined;

    const asNumber = Number(value);

    if (!Number.isSafeInteger(asNumber) || asNumber <= 0) return undefined;

    return asNumber;

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
 * // Record each file execution
 * await tracker.recordExecution({
 *     changeId: opId,
 *     filepath: '/project/sql/001.sql',
 *     checksum: 'abc123...',
 *     status: 'success',
 *     durationMs: 42,
 * })
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

    constructor(db: Kysely<NoormDatabase>, configName: string, dialect: Dialect = 'sqlite') {

        this.#db = db;
        this.#ndb = noormDb(db, dialect);
        this.#tables = getNoormTables(dialect);
        this.#configName = configName;
        this.#dialect = dialect;

    }

    /**
     * Check if a file needs to run.
     *
     * A file needs to run if:
     * - Force flag is set
     * - No previous execution exists (new file)
     * - Previous execution failed
     * - Parent change is stale (schema was torn down)
     * - Checksum differs (file changed)
     *
     * @param filepath - File path to check
     * @param checksum - Current file checksum
     * @param force - Force re-run regardless of status
     * @param excludeOperationId - Operation whose own rows should be ignored.
     * `executeFiles` inserts a `pending` row for every discovered file
     * *before* running any of them (for batch visibility), so within that
     * same operation the newest row for a file is always its own pending
     * record — reading as "new" forever and making checksum-based skipping
     * unreachable. Passing the running operation's id here excludes those
     * rows so the lookup finds the last *completed* operation instead.
     * @returns Whether file needs to run and why
     */
    async needsRun(
        filepath: string,
        checksum: string,
        force: boolean,
        excludeOperationId?: number,
    ): Promise<NeedsRunResult> {

        // Force always runs
        if (force) {

            return { needsRun: true, reason: 'force' };

        }

        // Find most recent execution for this file and config
        // Also fetch the parent change status to check for stale
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
                eb.ref(`${this.#tables.executions}.skip_reason`).as('skip_reason'),
                eb.ref(`${this.#tables.change}.status`).as('change_status'),
            ])
            .where(`${this.#tables.executions}.filepath`, '=', filepath)
            .where(`${this.#tables.change}.config_name`, '=', this.#configName);

        if (excludeOperationId !== undefined) {

            query = query.where(`${this.#tables.executions}.change_id`, '<>', excludeOperationId);

        }

        const [record, err] = await attempt(() =>
            query
                .orderBy(`${this.#tables.executions}.id`, 'desc')
                .limit(1)
                .executeTakeFirst(),
        );

        if (err) {

            observer.emit('error', {
                source: 'runner',
                error: err,
                context: { filepath, operation: 'needs-run-check' },
            });

            // Distinct from 'new': the SELECT itself failed, so whether a
            // record exists is genuinely unknown. Reporting this as 'new'
            // would make a transient read failure indistinguishable from a
            // first-ever run in logs and audits.
            return { needsRun: true, reason: 'error' };

        }

        // No previous record - new file
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

        // A `pending` row is an upfront placeholder for batch visibility whose
        // file never reached execution, so it carries no outcome to compare
        // against and must run.
        //
        // `skipped` means two different things. A cascade skip (an earlier file
        // in the batch failed) also never executed, so it must run too. But an
        // `unchanged` skip is the recorded outcome of a correct decision, and
        // treating it as "never ran" made the third consecutive build re-execute
        // a file the second build had rightly skipped -- failing on any DDL that
        // is not idempotent. Fall through and re-compare the checksum instead.
        const isUnchangedSkip = record.exec_status === 'skipped' && record.skip_reason === 'unchanged';

        if (record.exec_status === 'pending' || (record.exec_status === 'skipped' && !isUnchangedSkip)) {

            return { needsRun: true, reason: 'new' };

        }

        // Parent change is stale (schema was torn down) - needs re-run
        if (record.change_status === 'stale') {

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

        // Unchanged - skip
        return {
            needsRun: false,
            skipReason: 'unchanged',
            previousChecksum: record.checksum,
        };

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

        const insertQuery = this.#ndb
            .insertInto(this.#tables.change)
            .values({
                name: data.name,
                change_type: data.changeType as ChangeType,
                direction: dbDirection,
                status: 'pending',
                config_name: data.configName,
                executed_by: data.executedBy,
            });

        // Three id-retrieval strategies, one per driver capability:
        //   mssql   OUTPUT inserted.id
        //   mysql   no RETURNING clause exists — the driver reports the
        //           generated key on the insert result itself. Read it from
        //           there rather than issuing LAST_INSERT_ID() as a second
        //           query: that function is per-connection, and Kysely
        //           returns the connection to the pool between statements.
        //   others  RETURNING for an atomic insert+get-id
        let id: number | undefined;

        if (this.#dialect === 'mssql') {

            const [result, insertErr] = await attempt(() =>
                insertQuery
                    .output('inserted.id as id')
                    .executeTakeFirstOrThrow(),
            );

            if (insertErr) {

                throw new Error('Failed to create operation record', { cause: insertErr });

            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            id = toOperationId((result as any)?.id);

        }
        else if (this.#dialect === 'mysql') {

            const [result, err] = await attempt(() => insertQuery.executeTakeFirst());

            if (err) {

                throw new Error('Failed to create operation record', { cause: err });

            }

            id = toOperationId(result?.insertId);

        }
        else {

            const [result, err] = await attempt(() =>
                insertQuery.returning('id').executeTakeFirstOrThrow(),
            );

            if (err) {

                throw new Error('Failed to create operation record', { cause: err });

            }

            id = toOperationId(result?.id);

            // SQLite with better-sqlite3 may return null for RETURNING
            if (id === undefined) {

                const lastIdQuery = this.#lastInsertIdQuery();

                if (lastIdQuery) {

                    const [lastIdResult] = await attempt(() => lastIdQuery.execute(this.#db));
                    id = toOperationId(lastIdResult?.rows?.[0]?.id);

                }

            }

        }

        if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) {

            throw new Error(`Invalid operation ID returned: ${id}`);

        }

        return id;

    }

    /**
     * Get dialect-specific last-insert-id query.
     *
     * Returns null if the dialect should always use RETURNING/OUTPUT.
     */
    #lastInsertIdQuery(): ReturnType<typeof sql<{ id: number }>> | null {

        switch (this.#dialect) {

        case 'sqlite':
            return sql<{ id: number }>`SELECT last_insert_rowid() as id`;

        case 'mysql':
            return sql<{ id: number }>`SELECT LAST_INSERT_ID() as id`;

        case 'mssql':
            return sql<{ id: number }>`SELECT SCOPE_IDENTITY() as id`;

        case 'postgres':
            return sql<{ id: number }>`SELECT lastval() as id`;

        default:
            return null;

        }

    }

    /**
     * Record a file execution.
     *
     * Creates a child record in __noorm_executions__ linked
     * to the parent operation.
     *
     * @param data - Execution data
     */
    async recordExecution(data: RecordExecutionData): Promise<void> {

        const [, err] = await attempt(() =>
            this.#ndb
                .insertInto(this.#tables.executions)
                .values({
                    change_id: data.changeId,
                    filepath: data.filepath,
                    file_type: 'sql',
                    checksum: data.checksum,
                    status: data.status as ExecutionStatus,
                    skip_reason: data.skipReason ?? '',
                    error_message: data.errorMessage ?? '',
                    duration_ms: Math.round(data.durationMs ?? 0),
                })
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'runner',
                error: err,
                context: { filepath: data.filepath, operation: 'record-execution' },
            });

        }

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
     * Create pending file records for all files upfront.
     *
     * Creates records so the batch is fully visible. On failure,
     * remaining files can be marked as skipped.
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
     * Similar to needsRun but checks by change name instead of filepath.
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
