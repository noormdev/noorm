import { sql, type Kysely, type RawBuilder } from 'kysely';

import type { Dialect } from '../connection/types.js';
import { toOperationId } from '../shared/operation-id.js';
import { getNoormTables, noormDb } from '../shared/tables.js';
import type {
    NoormDatabase, NoormPipelineRun, NoormPipelineStep,
    PipelineRunStatus, PipelineStepStatus, PipelineTransactionOutcome,
} from '../shared/tables.js';
import { exactIdentifier } from './exact-identifier.js';
import { isHistoryLimit, isRunId } from './parse.js';

/** Trusted connection and provenance for bookkeeping, independent of workflow transactions. */
export interface PipelineHistoryContext {
    db: Kysely<NoormDatabase>;
    dialect: Dialect;
    configName: string;
    executedBy: string;
    cliVersion: string;
}

/** One run with its steps, as stored. */
export interface PipelineHistoryRecord {
    run: NoormPipelineRun;
    steps: NoormPipelineStep[];
}

/** Metadata only: invocation input and rendered SQL must never be passed here. */
export interface PipelineIntent {
    slug: string;
    manifestChecksum: string;
    transaction: 'pipeline' | 'step' | 'none';
    singleRun: boolean;
    activeKey?: string | null;
    steps: readonly {
        stepNo: number;
        name: string;
        filepath: string;
        checksum: string;
        needs: readonly number[];
    }[];
}

interface TimingOutcome {
    started_at?: Date | null;
    finished_at?: Date | null;
    duration_ms: number;
    /** Already sanitized by the execution layer; bounded again before storage. */
    error_message?: string;
}

/** The terminal run and per-step outcomes written when a run finalizes. */
export interface PipelineRunOutcomes {
    run: TimingOutcome & { status: PipelineRunStatus; transaction_outcome: PipelineTransactionOutcome };
    steps: readonly (TimingOutcome & {
        step_no: number;
        status: PipelineStepStatus;
        transaction_outcome: PipelineTransactionOutcome | 'not_started';
        skip_reason?: string;
    })[];
}

/** Throws unless `id` is a storable run ID. */
export function assertRunId(id: number): void {

    if (!isRunId(id)) throw new Error('Pipeline run ID must be a positive safe integer');

}

const DEFAULT_HISTORY_LIMIT = 20;

/** Throws unless `limit` is an accepted history page size. */
export function assertHistoryLimit(limit: number): void {

    if (!isHistoryLimit(limit)) throw new Error('Pipeline history limit must be an integer from 1 to 100');

}

function boundedText(value: string | undefined): string {

    return (value ?? '').replace(/(?![\t\n\r])\p{Cc}/gu, '').slice(0, 2000);

}

// Naive timestamps are UTC; PostgreSQL/MySQL drivers otherwise apply local time.
function timestamp(value: Date, dialect: Dialect): RawBuilder<Date> | Date;
function timestamp(value: Date | null | undefined, dialect: Dialect): RawBuilder<Date> | Date | null;
function timestamp(value: Date | null | undefined, dialect: Dialect) {

    if (value == null) return null;
    if (dialect === 'mssql') return value;

    const iso = value.toISOString();

    return sql<Date>`${dialect === 'sqlite' ? iso : iso.replace('T', ' ').replace('Z', '')}`;

}

function readTimestamp(value: Date | string, dialect: Dialect): Date {

    if (value instanceof Date) {

        if (dialect === 'sqlite' || dialect === 'mssql') return new Date(value);

        return new Date(Date.UTC(
            value.getFullYear(), value.getMonth(), value.getDate(),
            value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds(),
        ));

    }

    const normalized = value.replace(' ', 'T');

    return new Date(/(?:Z|[+-]\d\d:?\d\d)$/i.test(normalized) ? normalized : `${normalized}Z`);

}

function normalizeRun(row: NoormPipelineRun, dialect: Dialect): NoormPipelineRun {

    return {
        ...row,
        id: Number(row.id),
        single_run: Boolean(row.single_run),
        created_at: readTimestamp(row.created_at, dialect),
        started_at: row.started_at == null ? null : readTimestamp(row.started_at, dialect),
        finished_at: row.finished_at == null ? null : readTimestamp(row.finished_at, dialect),
    };

}

function normalizeStep(row: NoormPipelineStep, dialect: Dialect): NoormPipelineStep {

    return {
        ...row,
        pipeline_run_id: Number(row.pipeline_run_id),
        started_at: row.started_at == null ? null : readTimestamp(row.started_at, dialect),
        finished_at: row.finished_at == null ? null : readTimestamp(row.finished_at, dialect),
    };

}

/** Atomically creates the pending run, optional admission key, and every intended step. */
export async function createPipelineIntent(context: PipelineHistoryContext, intent: PipelineIntent): Promise<number> {

    const { dialect } = context;
    const tables = getNoormTables(dialect);
    const db = noormDb(context.db, dialect);

    return db.transaction().execute(async (trx) => {

        const insert = trx.insertInto(tables.pipelineRun).values({
            slug: intent.slug,
            config_name: context.configName,
            executed_by: context.executedBy,
            cli_version: context.cliVersion,
            manifest_checksum: intent.manifestChecksum,
            transaction_policy: intent.transaction,
            single_run: dialect === 'sqlite' ? sql<boolean>`${intent.singleRun ? 1 : 0}` : intent.singleRun,
            status: 'pending',
            transaction_outcome: 'pending',
            created_at: timestamp(new Date(), dialect),
            active_key: intent.activeKey ?? null,
        });
        let rawId: unknown;
        if (dialect === 'mssql') {

            const result = await insert.output('inserted.id as id').executeTakeFirstOrThrow();
            rawId = result && typeof result === 'object' && 'id' in result ? result.id : undefined;

        }
        else if (dialect === 'mysql') {

            rawId = (await insert.executeTakeFirstOrThrow()).insertId;

        }
        else {

            const result = await insert.returning('id').executeTakeFirst();
            rawId = result?.id;

        }
        const id = toOperationId(rawId);
        if (id === undefined) throw new Error('Failed to retrieve pipeline run ID');
        for (const step of intent.steps) {

            await trx.insertInto(tables.pipelineStep).values({
                pipeline_run_id: id,
                step_no: step.stepNo,
                name: step.name,
                filepath: step.filepath,
                checksum: step.checksum,
                needs: JSON.stringify(step.needs),
                status: 'pending',
                transaction_outcome: 'pending',
            }).execute();

        }

        return id;

    });

}

/** Flush buffered results only after workflow activity has settled. Does not release admission. */
export async function finalizePipelineRun(
    context: PipelineHistoryContext,
    id: number,
    outcomes: PipelineRunOutcomes,
): Promise<void> {

    assertRunId(id);
    const tables = getNoormTables(context.dialect);
    const db = noormDb(context.db, context.dialect);
    await db.transaction().execute(async (trx) => {

        const run = await trx.selectFrom(tables.pipelineRun).select('id')
            .where('id', '=', id).where('config_name', '=', context.configName)
            .where(exactIdentifier(context.dialect, 'config_name', context.configName)).executeTakeFirst();
        if (!run) throw new Error('Pipeline run not found');
        const intended = await trx.selectFrom(tables.pipelineStep).select('step_no')
            .where('pipeline_run_id', '=', id).execute();
        const remaining = new Set(intended.map((step) => Number(step.step_no)));
        const terminal = outcomes.run.status !== 'pending' && outcomes.run.status !== 'running';
        for (const step of outcomes.steps) {

            if (!remaining.delete(step.step_no)) throw new Error('Unexpected or duplicate pipeline step');
            if (terminal && (step.status === 'pending' || step.status === 'running')) {

                throw new Error('Terminal pipeline run requires terminal step outcomes');

            }

        }
        if (terminal && remaining.size !== 0) throw new Error('Terminal pipeline run requires every step outcome');
        await trx.updateTable(tables.pipelineRun).set({
            status: outcomes.run.status,
            transaction_outcome: outcomes.run.transaction_outcome,
            started_at: timestamp(outcomes.run.started_at, context.dialect),
            finished_at: timestamp(outcomes.run.finished_at, context.dialect),
            duration_ms: Math.round(outcomes.run.duration_ms),
            error_message: boundedText(outcomes.run.error_message),
        }).where('id', '=', id).where('config_name', '=', context.configName)
            .where(exactIdentifier(context.dialect, 'config_name', context.configName)).execute();
        for (const step of outcomes.steps) {

            await trx.updateTable(tables.pipelineStep).set({
                status: step.status,
                transaction_outcome: step.transaction_outcome,
                started_at: timestamp(step.started_at, context.dialect),
                finished_at: timestamp(step.finished_at, context.dialect),
                duration_ms: Math.round(step.duration_ms),
                error_message: boundedText(step.error_message),
                skip_reason: boundedText(step.skip_reason),
            }).where('pipeline_run_id', '=', id).where('step_no', '=', step.step_no).execute();

        }

    });

}

/** Loads one run and its steps for the active config; `null` when the id is unknown or belongs to another config. */
export async function getPipelineRun(
    context: PipelineHistoryContext,
    id: number,
): Promise<PipelineHistoryRecord | null> {

    assertRunId(id);
    const tables = getNoormTables(context.dialect);
    const db = noormDb(context.db, context.dialect);
    const run = await db.selectFrom(tables.pipelineRun).selectAll()
        .where('id', '=', id).where('config_name', '=', context.configName)
        .where(exactIdentifier(context.dialect, 'config_name', context.configName)).executeTakeFirst();
    if (!run) return null;
    const steps = await db.selectFrom(tables.pipelineStep).select([
        'pipeline_run_id', 'step_no', 'name', 'filepath', 'checksum', 'needs',
        'status', 'transaction_outcome', 'started_at', 'finished_at',
        'error_message', 'skip_reason', 'duration_ms',
    ])
        .where('pipeline_run_id', '=', id).orderBy('step_no', 'asc').execute();

    return {
        run: normalizeRun(run, context.dialect),
        steps: steps.map((step) => normalizeStep(step, context.dialect)),
    };

}

/** Lists a pipeline's runs for the active config, newest first. */
export async function listPipelineHistory(
    context: PipelineHistoryContext,
    slug: string,
    options: { limit?: number } = {},
): Promise<NoormPipelineRun[]> {

    const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
    assertHistoryLimit(limit);
    const tables = getNoormTables(context.dialect);
    const db = noormDb(context.db, context.dialect);
    const runs = await db.selectFrom(tables.pipelineRun).selectAll()
        .where('config_name', '=', context.configName).where('slug', '=', slug)
        .where(exactIdentifier(context.dialect, 'config_name', context.configName))
        .where(exactIdentifier(context.dialect, 'slug', slug))
        .orderBy('id', 'desc').limit(limit).execute();

    return runs.map((run) => normalizeRun(run, context.dialect));

}
