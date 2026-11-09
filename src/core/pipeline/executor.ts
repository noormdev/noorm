import { randomBytes } from 'node:crypto';

import { attempt } from '@logosdx/utils';
import { sql, type DatabaseConnection, type Kysely } from 'kysely';

import { createConnection } from '../connection/factory.js';
import type { ConnectionResult } from '../connection/types.js';
import { executeSqlBody } from '../runner/mssql-batches.js';
import type { NoormDatabase, PipelineTransactionOutcome } from '../shared/tables.js';
import { admitPipelineRun, releasePipelineAdmission, type PipelineAdmission } from './admission.js';
import { loadPipelineDefinition } from './definition.js';
import { finalizePipelineRun, type PipelineHistoryContext } from './history.js';
import { preparePipeline } from './prepare.js';
import { getPipelineConcurrency, schedulePipelineSteps } from './scheduler.js';
import { assertManagedPipelineSql, hasAuthorTransactionControl } from './sql-guard.js';
import type {
    PipelineContext, PipelineDryRunResult, PipelineError, PipelineRunOptions, PipelineRunResult,
    PipelineStepMetadata, PipelineStepResult, PreparedPipeline, PreparedPipelineStep,
} from './types.js';

interface MssqlTransactionConnection extends DatabaseConnection {
    beginTransaction(settings: Record<string, never>): Promise<void>;
    commitTransaction(): Promise<void>;
    rollbackTransaction(): Promise<void>;
}

function hasMssqlTransactionControls(connection: DatabaseConnection): connection is MssqlTransactionConnection {

    return 'beginTransaction' in connection && typeof connection.beginTransaction === 'function'
        && 'commitTransaction' in connection && typeof connection.commitTransaction === 'function'
        && 'rollbackTransaction' in connection && typeof connection.rollbackTransaction === 'function';

}

async function transactionControl(
    db: Kysely<NoormDatabase>, dialect: PipelineContext['dialect'], action: 'begin' | 'commit' | 'rollback',
): Promise<void> {

    if (dialect !== 'mssql') {

        await sql.raw(action).execute(db);

        return;

    }

    // Release this provider callback before issuing body queries on the same pinned connection.
    await db.getExecutor().provideConnection(async (connection) => {

        if (!hasMssqlTransactionControls(connection)) {

            throw new Error('MSSQL connection does not support native transaction controls');

        }
        if (action === 'begin') await connection.beginTransaction({});
        else if (action === 'commit') await connection.commitTransaction();
        else await connection.rollbackTransaction();

    });

}

// 'unverified' means the probe itself failed, which proves nothing about who owns the transaction.
type OwnershipProof = 'owned' | 'lost' | 'unverified';

interface TransactionOwnership {
    id: string;
    proof: OwnershipProof;
}

interface MssqlTransactionState {
    transaction_count: number;
    transaction_state: number;
    transaction_id: string;
}

async function readMssqlTransaction(db: Kysely<NoormDatabase>): Promise<MssqlTransactionState | undefined> {

    const state = await sql<MssqlTransactionState>`
        SELECT @@TRANCOUNT AS transaction_count, XACT_STATE() AS transaction_state,
            CAST(CURRENT_TRANSACTION_ID() AS varchar(30)) AS transaction_id
    `.execute(db);

    return state.rows[0];

}

async function readPostgresTransactionId(db: Kysely<NoormDatabase>): Promise<string> {

    const row = await sql<{ id: string }>`SELECT pg_current_xact_id()::text AS id`.execute(db);

    return row.rows[0]?.id ?? '';

}

async function markOwnership(
    db: Kysely<NoormDatabase>, dialect: PipelineContext['dialect'], nonce: string,
): Promise<TransactionOwnership> {

    if (dialect === 'mssql') {

        const state = await readMssqlTransaction(db);
        if (!state) throw new Error('MSSQL transaction id unavailable');

        return { id: state.transaction_id, proof: 'owned' };

    }
    await sql.raw(`SAVEPOINT ${nonce}`).execute(db);
    const id = dialect === 'postgres' ? await readPostgresTransactionId(db) : '';
    if (dialect === 'postgres' && id === '') throw new Error('PostgreSQL transaction id unavailable');

    return { id, proof: 'owned' };

}

function isMissingSavepoint(error: unknown): boolean {

    if (!error || typeof error !== 'object') return false;
    if ('code' in error && ['3B001', '25P01', 'ER_SP_DOES_NOT_EXIST'].includes(String(error.code))) return true;

    return 'message' in error && /no such savepoint/i.test(String(error.message));

}

function toProof(owned: boolean | null, error: Error | null): OwnershipProof {

    if (!error) return owned ? 'owned' : 'lost';

    return isMissingSavepoint(error) ? 'lost' : 'unverified';

}

async function ownsAfterStep(
    db: Kysely<NoormDatabase>, dialect: PipelineContext['dialect'], nonce: string, ownership: TransactionOwnership,
): Promise<OwnershipProof> {

    const [owned, error] = await attempt(async () => {

        if (dialect === 'postgres') return await readPostgresTransactionId(db) === ownership.id;
        if (dialect === 'mssql') {

            const state = await readMssqlTransaction(db);

            return state?.transaction_count === 1 && state.transaction_state === 1 && state.transaction_id === ownership.id;

        }
        await sql.raw(`RELEASE SAVEPOINT ${nonce}`).execute(db);
        await sql.raw(`SAVEPOINT ${nonce}`).execute(db);

        return true;

    });

    return toProof(owned, error);

}

// Unlike the post-step check, a doomed (MSSQL) or aborted (PostgreSQL) transaction can still be noorm's.
async function ownsBeforeRollback(
    db: Kysely<NoormDatabase>, dialect: PipelineContext['dialect'], nonce: string, ownership: TransactionOwnership,
): Promise<OwnershipProof> {

    const [owned, error] = await attempt(async () => {

        if (dialect === 'mssql') {

            const state = await readMssqlTransaction(db);

            return (state?.transaction_count ?? 0) >= 1 && state?.transaction_id === ownership.id;

        }
        await sql.raw(`ROLLBACK TO SAVEPOINT ${nonce}`).execute(db);

        return true;

    });

    return toProof(owned, error);

}

// The native MSSQL rollback raises when no transaction is open.
async function hasOpenMssqlTransaction(db: Kysely<NoormDatabase>): Promise<boolean> {

    const [state, err] = await attempt(() => readMssqlTransaction(db));

    return !!err || !state || state.transaction_count > 0;

}

const OWNERSHIP_UNVERIFIED: PipelineError = {
    phase: 'cleanup',
    code: 'OWNERSHIP_UNVERIFIED',
    message: 'Pipeline cleanup failed: transaction ownership could not be verified, so its outcome is unknown',
};

const OWNERSHIP_LOST: PipelineError = {
    phase: 'execute',
    code: 'TRANSACTION_ESCAPED',
    message: 'Pipeline execute failed: the step ended or replaced the managed transaction, so its outcome is unknown',
};

function safeError(phase: PipelineError['phase'], error?: unknown, stepNo?: number): PipelineError {

    const result: PipelineError = { phase, message: `Pipeline ${phase} failed` };
    if (stepNo !== undefined) result.stepNo = stepNo;
    if (error && typeof error === 'object' && 'code' in error) {

        const code = error.code;
        if (typeof code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(code)) result.code = code;

    }

    return result;

}

function metadata(step: PreparedPipelineStep): PipelineStepMetadata {

    return { stepNo: step.stepNo, name: step.id, filepath: step.sqlPath, checksum: step.checksum, needs: step.needs };

}

type ScheduleResult = { failed: boolean; interrupted: boolean };

interface RunState {
    readonly context: PipelineContext;
    readonly plan: PreparedPipeline;
    readonly concurrency: number;
    readonly signal: AbortSignal | undefined;
    readonly memoryDatabase: boolean;
    readonly nonce: string;
    readonly ownershipByDb: WeakMap<Kysely<NoormDatabase>, TransactionOwnership>;
    readonly steps: PipelineStepResult[];
    readonly secondaryErrors: PipelineError[];
    primaryError: PipelineError | null;
    activitySettled: boolean;
    workflowActivityPossible: boolean;
    linearAuthorControl: boolean;
    interrupted: boolean;
    workflowDb: Kysely<NoormDatabase>;
    ownedConnection?: ConnectionResult;
}

interface BoundarySettlement {
    outcome: PipelineTransactionOutcome;
    settled: boolean;
    commitUncertain: boolean;
}

function createRunState(
    context: PipelineContext, plan: PreparedPipeline, concurrency: number, signal: AbortSignal | undefined,
): RunState {

    return {
        context,
        plan,
        concurrency,
        signal,
        memoryDatabase: context.dialect === 'sqlite'
            && (context.connectionConfig.filename ?? context.connectionConfig.database) === ':memory:',
        nonce: `noorm_${randomBytes(8).toString('hex')}`,
        ownershipByDb: new WeakMap(),
        steps: plan.steps.map((step) => ({
            ...metadata(step), status: 'skipped', transactionOutcome: 'not_started', startedAt: null,
            finishedAt: null, durationMs: 0, error: null, skipReason: 'not_started',
        })),
        secondaryErrors: [],
        primaryError: null,
        activitySettled: true,
        workflowActivityPossible: false,
        linearAuthorControl: false,
        interrupted: false,
        workflowDb: context.db,
    };

}

function addError(state: RunState, error: PipelineError): void {

    if (state.primaryError === null) state.primaryError = error;
    else state.secondaryErrors.push(error);

}

function recordInterruption(state: RunState): void {

    if (state.interrupted) return;
    state.interrupted = true;
    addError(state, safeError('interrupted'));

}

async function disposeMemory(state: RunState): Promise<void> {

    const { context } = state;
    const [, error] = await attempt(async () => (context.disposeMemoryConnection?.() ?? context.db.destroy()));

    if (error) addError(state, safeError('cleanup', error));

}

async function executeStep(
    state: RunState, db: Kysely<NoormDatabase>, index: number, stop: () => void,
): Promise<boolean> {

    const { context, plan } = state;
    const source = plan.steps[index]!;
    const result = state.steps[index]!;
    const authorControl = plan.transaction === 'none' && hasAuthorTransactionControl(source.sql, context.dialect);
    if (plan.mode === 'linear' && authorControl) state.linearAuthorControl = true;
    result.startedAt = new Date();
    delete result.skipReason;
    const settleError = (error: PipelineError) => {

        stop();
        if (result.error === null) {

            result.error = error;
            addError(state, result.error);

        }

    };
    const reportFailure = (error?: unknown) => settleError(safeError('execute', error, result.stepNo));
    const reportFixed = (fixed: PipelineError) => settleError({ ...fixed, stepNo: result.stepNo });

    const [failure, thrown] = await attempt(() => executeSqlBody({ db, dialect: context.dialect, onError: reportFailure }, source.sql));
    if (thrown) reportFailure(thrown);
    result.finishedAt = new Date();
    result.durationMs = result.finishedAt.getTime() - result.startedAt.getTime();
    if (thrown || failure !== null) {

        if (result.error === null) reportFailure();
        result.status = 'failed';
        result.transactionOutcome = 'unknown';

        return false;

    }
    if (plan.transaction === 'none') {

        result.status = 'success';
        result.transactionOutcome = authorControl || (plan.mode === 'linear' && state.linearAuthorControl) ? 'unknown' : 'committed';

        return true;

    }

    const ownership = state.ownershipByDb.get(db);
    const proof = ownership ? await ownsAfterStep(db, context.dialect, state.nonce, ownership) : 'lost';
    if (proof !== 'owned') {

        if (ownership) ownership.proof = proof;
        reportFixed(proof === 'lost' ? OWNERSHIP_LOST : OWNERSHIP_UNVERIFIED);
        result.status = 'failed';
        result.transactionOutcome = 'unknown';

        return false;

    }
    result.status = 'success';
    result.transactionOutcome = 'pending';

    return true;

}

async function openBoundary(state: RunState, db: Kysely<NoormDatabase>, stop?: () => void): Promise<boolean> {

    const { context } = state;
    const [, beginError] = await attempt(() => transactionControl(db, context.dialect, 'begin'));
    let setupError = beginError;
    let rolledBackSetup = false;

    if (!setupError) {

        const [marked, markError] = await attempt(() => markOwnership(db, context.dialect, state.nonce));

        if (marked) {

            state.ownershipByDb.set(db, marked);

            return true;

        }
        setupError = markError;
        const [, rollbackError] = await attempt(() => transactionControl(db, context.dialect, 'rollback'));
        rolledBackSetup = !rollbackError;

    }

    stop?.();
    addError(state, safeError('execute', setupError));
    if (!rolledBackSetup) {

        state.activitySettled = false;
        if (state.memoryDatabase) await disposeMemory(state);

    }

    return false;

}

async function commitBoundary(
    state: RunState, db: Kysely<NoormDatabase>, settlement: BoundarySettlement, stop?: () => void,
): Promise<boolean> {

    const [, commitError] = await attempt(() => transactionControl(db, state.context.dialect, 'commit'));

    if (!commitError) {

        settlement.outcome = 'committed';

        return true;

    }
    stop?.();
    addError(state, safeError('commit', commitError));
    settlement.commitUncertain = true;

    return false;

}

async function isMssqlQuiescent(db: Kysely<NoormDatabase>): Promise<boolean> {

    // The native rollback callback has released the pinned provider. Capture
    // session state before any table access can start an implicit transaction.
    const [state] = await attempt(() => sql<{ transaction_count: number; transaction_state: number }>`
        DECLARE @transaction_count int = @@TRANCOUNT;
        DECLARE @transaction_state int = XACT_STATE();
        SELECT @transaction_count AS transaction_count, @transaction_state AS transaction_state;
    `.execute(db));

    return state?.rows[0]?.transaction_count === 0 && state.rows[0]?.transaction_state === 0;

}

async function rollbackBoundary(
    state: RunState, db: Kysely<NoormDatabase>, settlement: BoundarySettlement,
): Promise<void> {

    const { context, nonce } = state;
    const ownership = state.ownershipByDb.get(db);
    let proof: OwnershipProof = ownership?.proof ?? 'lost';

    if (ownership && proof === 'owned') proof = await ownsBeforeRollback(db, context.dialect, nonce, ownership);
    const proven = proof === 'owned';
    if (proof === 'unverified') {

        settlement.settled = false;
        if (ownership?.proof !== 'unverified') addError(state, OWNERSHIP_UNVERIFIED);

    }

    const [, rollbackError] = await attempt(async () => {

        if (proven || context.dialect !== 'mssql' || await hasOpenMssqlTransaction(db)) {

            await transactionControl(db, context.dialect, 'rollback');

        }

    });

    if (!rollbackError) {

        if (proven && settlement.settled && !settlement.commitUncertain) settlement.outcome = 'rolled_back';

        return;

    }
    addError(state, safeError('rollback', rollbackError));
    settlement.settled = false;
    if (context.dialect === 'mssql') settlement.settled = await isMssqlQuiescent(db);

}

async function probeSqliteSession(state: RunState, db: Kysely<NoormDatabase>, settlement: BoundarySettlement): Promise<void> {

    // An active or unusable connection cannot prove quiescence.
    const [, probeError] = await attempt(async () => {

        await sql.raw('begin').execute(db);
        await sql.raw('rollback').execute(db);

    });

    if (!probeError) settlement.settled = true;
    else if (state.memoryDatabase) await disposeMemory(state);

}

async function runBoundary(
    state: RunState, db: Kysely<NoormDatabase>, indices: number[], run: () => Promise<ScheduleResult>, stop?: () => void,
): Promise<ScheduleResult> {

    const settlement: BoundarySettlement = { outcome: 'unknown', settled: true, commitUncertain: false };

    if (!await openBoundary(state, db, stop)) return { failed: true, interrupted: false };

    const [scheduled, runError] = await attempt(run);
    let result: ScheduleResult;

    if (runError) {

        stop?.();
        addError(state, safeError('cleanup', runError));
        settlement.settled = false;
        result = { failed: true, interrupted: false };

    }
    else result = scheduled;

    if (result.interrupted) recordInterruption(state);
    if (!result.failed && !result.interrupted && !await commitBoundary(state, db, settlement, stop)) {

        result = { ...result, failed: true };

    }
    if (result.failed || result.interrupted) await rollbackBoundary(state, db, settlement);

    for (const index of indices) {

        const step = state.steps[index]!;
        if (step.status !== 'skipped') step.transactionOutcome = settlement.outcome;

    }
    if (!settlement.settled && state.context.dialect === 'sqlite') await probeSqliteSession(state, db, settlement);
    if (!settlement.settled) state.activitySettled = false;

    return result;

}

async function endServerTransaction(db: Kysely<NoormDatabase>, dialect: PipelineContext['dialect']): Promise<void> {

    if (dialect === 'mssql') {

        const count = await sql<{ transaction_count: number }>`SELECT @@TRANCOUNT AS transaction_count`.execute(db);
        if (count.rows[0]!.transaction_count > 0) await transactionControl(db, dialect, 'rollback');
        await sql.raw('SET IMPLICIT_TRANSACTIONS OFF').execute(db);

        return;

    }
    await transactionControl(db, dialect, 'rollback');
    if (dialect === 'mysql') await sql.raw('SET autocommit = 1').execute(db);

}

// Roll back recognized author-managed state before the lease can be reused.
// SQLite's empty transaction probe also handles an already committed transaction.
async function settleAuthorTransaction(state: RunState, db: Kysely<NoormDatabase>, stepNo?: number): Promise<void> {

    const { context } = state;

    if (context.dialect !== 'sqlite') {

        const [, error] = await attempt(() => endServerTransaction(db, context.dialect));

        if (error) {

            state.activitySettled = false;
            addError(state, safeError('cleanup', error, stepNo));

        }

        return;

    }

    // The probe below establishes whether the session is reusable.
    await attempt(() => transactionControl(db, context.dialect, 'rollback'));
    const [, probeError] = await attempt(async () => {

        await transactionControl(db, context.dialect, 'begin');
        await transactionControl(db, context.dialect, 'rollback');

    });

    if (probeError) {

        state.activitySettled = false;
        addError(state, safeError('cleanup', probeError, stepNo));
        if (state.memoryDatabase) await disposeMemory(state);

    }

}

function scheduleSteps(
    state: RunState, execute: (index: number, stop: () => void) => Promise<boolean>,
): Promise<ScheduleResult> {

    return schedulePipelineSteps(
        state.plan.steps, state.concurrency, (node, control) => execute(node.stepNo - 1, control.stop), state.signal,
    );

}

function runInOneTransaction(state: RunState): Promise<ScheduleResult> {

    return state.workflowDb.connection().execute((db) => {

        const indices: number[] = [];

        return runBoundary(state, db, indices, () => scheduleSteps(state, (index, stop) => {

            indices.push(index);

            return executeStep(state, db, index, stop);

        }));

    });

}

function runLinearUnmanaged(state: RunState): Promise<ScheduleResult> {

    return state.workflowDb.connection().execute(async (db) => {

        try {

            return await scheduleSteps(state, (index, stop) => executeStep(state, db, index, stop));

        }
        finally {

            if (state.linearAuthorControl) await settleAuthorTransaction(state, db);

        }

    });

}

async function runStepOnConnection(
    state: RunState, db: Kysely<NoormDatabase>, index: number, stop: () => void,
): Promise<boolean> {

    if (state.plan.transaction === 'none') {

        try {

            return await executeStep(state, db, index, stop);

        }
        finally {

            const source = state.plan.steps[index];

            if (source && hasAuthorTransactionControl(source.sql, state.context.dialect)) {

                await settleAuthorTransaction(state, db, index + 1);
                if (!state.activitySettled) stop();

            }

        }

    }
    const result = await runBoundary(state, db, [index], async () => ({
        failed: !await executeStep(state, db, index, stop), interrupted: false,
    }), stop);

    return !result.failed;

}

function runPerStep(state: RunState): Promise<ScheduleResult> {

    return scheduleSteps(state, async (index, stop) => {

        const [done, error] = await attempt(
            () => state.workflowDb.connection().execute((db) => runStepOnConnection(state, db, index, stop)),
        );

        if (error) {

            stop();
            addError(state, safeError('cleanup', error, index + 1));
            state.activitySettled = false;

            return false;

        }

        return done;

    });

}

async function openWorkflowConnection(state: RunState): Promise<void> {

    const { context, concurrency } = state;
    const owned = await createConnection({
        ...context.connectionConfig, pool: { min: 0, max: concurrency },
    }, `${context.configName}:pipeline`, { retries: 1, delay: 0 });
    state.ownedConnection = owned;

    // createConnection types its handle as Kysely<unknown>; this pool serves noorm's own tracking schema.
    let db = (owned.db as Kysely<NoormDatabase>).withoutPlugins();
    for (const plugin of context.db.getExecutor().plugins) db = db.withPlugin(plugin);
    state.workflowDb = db;

}

async function executeSteps(state: RunState): Promise<ScheduleResult> {

    const { plan, signal } = state;
    const notStarted = { failed: false, interrupted: true };

    if (signal?.aborted) return notStarted;
    if (!state.memoryDatabase) await openWorkflowConnection(state);
    if (signal?.aborted) return notStarted;

    state.workflowActivityPossible = true;
    if (plan.transaction === 'pipeline') return runInOneTransaction(state);
    if (plan.transaction === 'none' && plan.mode === 'linear') return runLinearUnmanaged(state);

    return runPerStep(state);

}

async function releaseOwnedConnection(state: RunState): Promise<void> {

    const { ownedConnection } = state;
    if (!ownedConnection) return;

    const [, error] = await attempt(() => ownedConnection.destroy());

    if (error) {

        addError(state, safeError('cleanup', error));
        state.activitySettled = false;

    }

}

function resolveTransactionOutcome(steps: PipelineStepResult[], primaryError: PipelineError | null): PipelineTransactionOutcome {

    const attempted = steps.filter((step) => step.status !== 'skipped');
    if (!attempted.length) return 'no_effects';

    const committed = attempted.some((step) => step.transactionOutcome === 'committed');
    if (attempted.some((step) => step.transactionOutcome === 'unknown')) return primaryError && committed ? 'partial' : 'unknown';
    if (committed) return primaryError ? 'partial' : 'committed';

    return 'rolled_back';

}

function resolveStatus(
    state: RunState, transactionOutcome: PipelineTransactionOutcome,
): PipelineRunResult['status'] {

    if (state.interrupted) return 'interrupted';
    if (!state.primaryError) return 'success';
    if (transactionOutcome === 'partial') return 'partial';

    return transactionOutcome === 'unknown' ? 'unknown' : 'failed';

}

async function finalizeRun(
    state: RunState,
    history: PipelineHistoryContext,
    admission: PipelineAdmission,
    summary: Pick<PipelineRunResult, 'status' | 'transactionOutcome' | 'startedAt' | 'finishedAt' | 'durationMs'>,
): Promise<PipelineRunResult['status']> {

    let { status } = summary;

    if (state.activitySettled) {

        const [, auditError] = await attempt(() => finalizePipelineRun(history, admission.runId, {
            run: {
                status, transaction_outcome: summary.transactionOutcome, started_at: summary.startedAt,
                finished_at: summary.finishedAt, duration_ms: summary.durationMs, error_message: state.primaryError?.message,
            },
            steps: state.steps.map((step) => ({
                step_no: step.stepNo, status: step.status, transaction_outcome: step.transactionOutcome,
                started_at: step.startedAt, finished_at: step.finishedAt, duration_ms: step.durationMs,
                error_message: step.error?.message, skip_reason: step.skipReason,
            })),
        }));

        if (auditError) {

            addError(state, safeError('audit', auditError));
            if (status === 'success') status = 'failed';

        }

    }

    const [, releaseError] = await attempt(
        () => releasePipelineAdmission(history, admission, { activitySettled: state.activitySettled }),
    );

    if (releaseError) {

        addError(state, safeError('cleanup', releaseError));
        if (status === 'success') status = 'failed';

    }

    return status;

}

/**
 * Renders, admits and executes a pipeline under its transaction mode, then records the outcome.
 * A boundary whose ownership cannot be proven is recorded as `unknown`, never as committed.
 *
 * @example
 * const result = await runPipeline(context, 'nightly-rollup', { input: { day: '2026-01-31' } });
 * if (result.status !== 'success') console.error(result.primaryError);
 */
export async function runPipeline(
    context: PipelineContext, slug: string, options: PipelineRunOptions = {},
): Promise<PipelineDryRunResult | PipelineRunResult> {

    if (context.db.isTransaction) throw new Error('Pipeline execution requires a database, not a caller-owned transaction');

    const definition = await loadPipelineDefinition({ projectRoot: context.projectRoot, pipelinesPath: context.pipelinesPath, slug });
    const plan = await preparePipeline(context, definition, { input: options.input, yes: context.yes });
    for (const step of plan.steps) assertManagedPipelineSql(step.sql, context.dialect, plan.transaction);

    const concurrency = getPipelineConcurrency(plan, context.dialect, context.poolMax);
    const base = { slug: plan.slug, mode: plan.mode, transaction: plan.transaction, concurrency, singleRun: plan.singleRun };

    if (options.dryRun) return {
        ...base, dryRun: true, runId: null, status: 'success', transactionOutcome: 'no_effects',
        steps: plan.steps.map(metadata),
    };

    const history: PipelineHistoryContext = {
        db: context.db, dialect: context.dialect, configName: context.configName,
        executedBy: context.identity.name, cliVersion: context.cliVersion,
    };
    const admission = await admitPipelineRun(history, {
        slug: plan.slug, manifestChecksum: plan.manifestChecksum, transaction: plan.transaction,
        singleRun: plan.singleRun, steps: plan.steps.map(metadata),
    });
    const startedAt = new Date();
    const state = createRunState(context, plan, concurrency, options.signal ?? context.signal);

    const [scheduled, executeError] = await attempt(() => executeSteps(state));

    if (executeError) {

        addError(state, safeError('cleanup', executeError));
        if (state.workflowActivityPossible) state.activitySettled = false;

    }
    else if (scheduled.interrupted) recordInterruption(state);

    await releaseOwnedConnection(state);

    const transactionOutcome = resolveTransactionOutcome(state.steps, state.primaryError);
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const status = await finalizeRun(state, history, admission, {
        status: resolveStatus(state, transactionOutcome), transactionOutcome, startedAt, finishedAt, durationMs,
    });

    return {
        ...base, dryRun: false, runId: admission.runId, status, transactionOutcome, startedAt, finishedAt, durationMs,
        steps: state.steps, primaryError: state.primaryError, secondaryErrors: state.secondaryErrors,
    };

}
