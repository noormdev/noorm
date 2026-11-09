import { describe, expect, it } from 'bun:test';
import type { Dialect } from '../../../src/core/connection/types.js';
import { admitPipelineRun, releasePipelineAdmission } from '../../../src/core/pipeline/admission.js';
import {
    finalizePipelineRun, getPipelineRun, listPipelineHistory,
    type PipelineHistoryContext, type PipelineIntent, type PipelineRunOutcomes,
} from '../../../src/core/pipeline/history.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';
import { withPipelineDatabase } from '../../utils/pipeline-db.js';

const dialects: Dialect[] = ['sqlite', 'postgres', 'mysql', 'mssql'];
const intent: PipelineIntent = {
    slug: 'close-period', transaction: 'step', singleRun: true, manifestChecksum: 'a'.repeat(64),
    steps: [
        { stepNo: 1, name: 'close', filepath: 'close.sql', checksum: 'b'.repeat(64), needs: [] },
        { stepNo: 2, name: 'report', filepath: 'report.sql', checksum: 'c'.repeat(64), needs: [1] },
    ],
};
const outcomes: PipelineRunOutcomes = {
    run: { status: 'success', transaction_outcome: 'committed', duration_ms: 5 },
    steps: [
        { step_no: 1, status: 'success', transaction_outcome: 'committed', duration_ms: 2 },
        { step_no: 2, status: 'success', transaction_outcome: 'committed', duration_ms: 3 },
    ],
};

for (const dialect of dialects) {

    describe(`pipeline exact configuration scope: ${dialect}`, () => {

        it('isolates history, finalization and protected ownership by exact identifiers', async () => {

            await withPipelineDatabase(dialect, async ({ db }) => {

                await bootstrapSchema(db, dialect);
                const lower: PipelineHistoryContext = {
                    db, dialect, configName: 'alpha', executedBy: 'test', cliVersion: 'test',
                };
                const upper: PipelineHistoryContext = { ...lower, configName: 'ALPHA' };
                const lowerOwner = await admitPipelineRun(lower, intent);
                const upperOwner = await admitPipelineRun(upper, intent);
                expect(lowerOwner.activeKey).not.toBeNull();
                expect(upperOwner.activeKey).not.toBeNull();
                expect(lowerOwner.activeKey).not.toBe(upperOwner.activeKey);

                expect((await listPipelineHistory(lower, intent.slug, { limit: 1 })).map((run) => run.id))
                    .toEqual([lowerOwner.runId]);
                expect((await listPipelineHistory(upper, intent.slug, { limit: 1 })).map((run) => run.id))
                    .toEqual([upperOwner.runId]);
                expect(await listPipelineHistory(lower, 'CLOSE-PERIOD')).toEqual([]);
                expect(await listPipelineHistory(lower, `${intent.slug} `)).toEqual([]);
                expect(await getPipelineRun(lower, upperOwner.runId)).toBeNull();
                expect(await getPipelineRun(upper, lowerOwner.runId)).toBeNull();
                const lowerBefore = await getPipelineRun(lower, lowerOwner.runId);
                const upperBefore = await getPipelineRun(upper, upperOwner.runId);
                expect(lowerBefore?.run.config_name).toBe('alpha');
                expect(upperBefore?.run.config_name).toBe('ALPHA');
                expect(lowerBefore?.steps).toHaveLength(2);
                expect(upperBefore?.steps).toHaveLength(2);

                await expect(finalizePipelineRun(upper, lowerOwner.runId, outcomes)).rejects.toThrow();
                await expect(finalizePipelineRun(lower, upperOwner.runId, outcomes)).rejects.toThrow();
                expect(await getPipelineRun(lower, lowerOwner.runId)).toEqual(lowerBefore);
                expect(await getPipelineRun(upper, upperOwner.runId)).toEqual(upperBefore);
                expect(await releasePipelineAdmission(upper, lowerOwner, { activitySettled: true })).toBe(false);
                expect(await releasePipelineAdmission(lower, upperOwner, { activitySettled: true })).toBe(false);
                expect((await getPipelineRun(lower, lowerOwner.runId))?.run.active_key).toBe(lowerOwner.activeKey);
                expect((await getPipelineRun(upper, upperOwner.runId))?.run.active_key).toBe(upperOwner.activeKey);

                await finalizePipelineRun(lower, lowerOwner.runId, outcomes);
                await finalizePipelineRun(upper, upperOwner.runId, outcomes);
                expect((await getPipelineRun(lower, lowerOwner.runId))?.run.status).toBe('success');
                expect((await getPipelineRun(upper, upperOwner.runId))?.steps.map((step) => step.status))
                    .toEqual(['success', 'success']);
                expect(await releasePipelineAdmission(lower, lowerOwner, { activitySettled: true })).toBe(true);
                expect(await releasePipelineAdmission(upper, upperOwner, { activitySettled: true })).toBe(true);
                expect((await getPipelineRun(lower, lowerOwner.runId))?.run.active_key).toBeNull();
                expect((await getPipelineRun(upper, upperOwner.runId))?.run.active_key).toBeNull();

            });

        }, 60_000);

    });

}
