import { createHash } from 'node:crypto';

import { attempt } from '@logosdx/utils';

import { getNoormTables, noormDb } from '../shared/tables.js';
import { exactIdentifier } from './exact-identifier.js';
import { PipelineCodedError } from './errors.js';
import { createPipelineIntent } from './history.js';
import type { PipelineHistoryContext, PipelineIntent } from './history.js';

/** Thrown when a `singleRun` pipeline already has an active run, so a second run is never admitted. */
export class PipelineBusyError extends PipelineCodedError {

    constructor() {

        super('PIPELINE_BUSY', 'Pipeline is already running');
        this.name = 'PipelineBusyError';

    }

}

/** The run record claimed for an admitted run; `activeKey` is the single-run guard to release. */
export interface PipelineAdmission {
    readonly runId: number;
    readonly activeKey: string | null;
}

function isGuardCollision(error: Error, dialect: PipelineHistoryContext['dialect']): boolean {

    const code = 'code' in error ? error.code : undefined;
    const constraint = 'constraint' in error ? error.constraint : undefined;
    const number = 'number' in error ? error.number : undefined;
    if (dialect === 'postgres') return code === '23505' && constraint === 'idx_pipeline_run_active_key';
    if (dialect === 'sqlite') {

        return error.message === 'UNIQUE constraint failed: __noorm_pipeline_run__.active_key';

    }
    if (dialect === 'mysql') {

        return code === 'ER_DUP_ENTRY' && /for key ['`](?:[^'`]*\.)?idx_pipeline_run_active_key['`]/.test(error.message);

    }

    return (number === 2601 || number === 2627)
        && /(?:index|constraint) ['"]idx_pipeline_run_active_key['"]/.test(error.message);

}

/** Atomically records an intent and claims its manifest-required guard. */
export async function admitPipelineRun(
    context: PipelineHistoryContext,
    intent: Omit<PipelineIntent, 'activeKey'>,
): Promise<PipelineAdmission> {

    const activeKey = intent.singleRun
        ? createHash('sha256').update(JSON.stringify([context.configName, intent.slug])).digest('hex')
        : null;

    const [runId, error] = await attempt(() => createPipelineIntent(context, { ...intent, activeKey }));

    if (error) {

        if (activeKey !== null && isGuardCollision(error, context.dialect)) throw new PipelineBusyError();
        throw error;

    }

    return { runId, activeKey };

}

/** Release only the matching owner after all workflow activity has settled. */
export async function releasePipelineAdmission(
    context: PipelineHistoryContext,
    admission: PipelineAdmission,
    options: { activitySettled: boolean },
): Promise<boolean> {

    if (!options.activitySettled || admission.activeKey === null) return false;
    const db = noormDb(context.db, context.dialect);
    const table = getNoormTables(context.dialect).pipelineRun;
    const result = await db.updateTable(table)
        .set({ active_key: null })
        .where('id', '=', admission.runId)
        .where('active_key', '=', admission.activeKey)
        .where('config_name', '=', context.configName)
        .where(exactIdentifier(context.dialect, 'config_name', context.configName))
        .executeTakeFirst();

    return result.numUpdatedRows > 0n;

}
