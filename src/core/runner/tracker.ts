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

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import { NOORM_TABLES } from '../shared/index.js';
import type { NoormDatabase, ChangeType, ExecutionStatus } from '../shared/index.js';
import type { NeedsRunResult, CreateOperationData, RecordExecutionData } from './types.js';

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
    readonly #configName: string;

    constructor(db: Kysely<NoormDatabase>, configName: string) {

        this.#db = db;
        this.#configName = configName;

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
     * @returns Whether file needs to run and why
     */
    async needsRun(filepath: string, checksum: string, force: boolean): Promise<NeedsRunResult> {

        // Force always runs
        if (force) {

            return { needsRun: true, reason: 'force' };

        }

        // Find most recent execution for this file and config
        // Also fetch the parent change status to check for stale
        const [record, err] = await attempt(() =>
            this.#db
                .selectFrom(NOORM_TABLES.executions)
                .innerJoin(
                    NOORM_TABLES.change,
                    `${NOORM_TABLES.change}.id`,
                    `${NOORM_TABLES.executions}.change_id`,
                )
                .select((eb) => [
                    eb.ref(`${NOORM_TABLES.executions}.checksum`).as('checksum'),
                    eb.ref(`${NOORM_TABLES.executions}.status`).as('exec_status'),
                    eb.ref(`${NOORM_TABLES.change}.status`).as('change_status'),
                ])
                .where(`${NOORM_TABLES.executions}.filepath`, '=', filepath)
                .where(`${NOORM_TABLES.change}.config_name`, '=', this.#configName)
                .orderBy(`${NOORM_TABLES.executions}.id`, 'desc')
                .limit(1)
                .executeTakeFirst(),
        );

        if (err) {

            observer.emit('error', {
                source: 'runner',
                error: err,
                context: { filepath, operation: 'needs-run-check' },
            });

            // On error, assume file needs to run
            return { needsRun: true, reason: 'new' };

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

        const [result, err] = await attempt(() =>
            this.#db
                .insertInto(NOORM_TABLES.change)
                .values({
                    name: data.name,
                    change_type: data.changeType as ChangeType,
                    direction: 'change',
                    status: 'pending',
                    config_name: data.configName,
                    executed_by: data.executedBy,
                })
                .returning('id')
                .executeTakeFirstOrThrow(),
        );

        if (err) {

            throw new Error('Failed to create operation record', { cause: err });

        }

        return result.id;

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
            this.#db
                .insertInto(NOORM_TABLES.executions)
                .values({
                    change_id: data.changeId,
                    filepath: data.filepath,
                    file_type: 'sql',
                    checksum: data.checksum,
                    status: data.status as ExecutionStatus,
                    skip_reason: data.skipReason ?? '',
                    error_message: data.errorMessage ?? '',
                    duration_ms: data.durationMs ?? 0,
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
     */
    async finalizeOperation(
        operationId: number,
        status: 'success' | 'failed',
        durationMs: number,
        checksum?: string,
        errorMessage?: string,
    ): Promise<void> {

        const [, err] = await attempt(() =>
            this.#db
                .updateTable(NOORM_TABLES.change)
                .set({
                    status,
                    duration_ms: durationMs,
                    checksum: checksum ?? '',
                    error_message: errorMessage ?? '',
                })
                .where('id', '=', operationId)
                .execute(),
        );

        if (err) {

            observer.emit('error', {
                source: 'runner',
                error: err,
                context: { operationId, operation: 'finalize-operation' },
            });

        }

    }

}
