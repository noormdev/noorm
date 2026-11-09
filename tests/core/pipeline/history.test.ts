import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Kysely, SqliteDialect, sql, type QueryExecutorProvider } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import {
    createPipelineIntent, finalizePipelineRun, getPipelineRun, listPipelineHistory,
} from '../../../src/core/pipeline/history.js';
import type { PipelineHistoryContext } from '../../../src/core/pipeline/history.js';
import type { NoormDatabase } from '../../../src/core/shared/tables.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';

const manifestChecksum = 'a'.repeat(64);
const checksums = ['b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)];
const intent = {
    slug: 'reconcile',
    manifestChecksum,
    transaction: 'pipeline' as const,
    singleRun: false,
    steps: [
        { stepNo: 1, name: 'first', filepath: 'first.sql.tmpl', checksum: checksums[0]!, needs: [] },
        { stepNo: 2, name: 'second', filepath: 'shared.sql', checksum: checksums[1]!, needs: [1] },
        { stepNo: 3, name: 'third', filepath: 'shared.sql', checksum: checksums[2]!, needs: [1, 2] },
    ],
};

async function rows(db: QueryExecutorProvider, table: 'pipeline_run' | 'pipeline_step' | 'change' | 'executions') {

    return (await sql<Record<string, unknown>>`select * from ${sql.table(`__noorm_${table}__`)}`.execute(db)).rows;

}

describe('pipeline: history', () => {

    let db: Kysely<NoormDatabase>;
    let context: PipelineHistoryContext;

    beforeEach(async () => {

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({ database: new BunSqliteDatabase(':memory:') as never }),
        });
        await bootstrapSchema(db, 'sqlite');
        context = {
            db, dialect: 'sqlite', configName: 'alpha',
            executedBy: 'operator@example.test', cliVersion: 'test-version',
        };

    });

    afterEach(async () => {

        await db.destroy();

    });

    it('should record independent complete pending intents and checksum provenance without input or SQL', async () => {

        const firstId = await createPipelineIntent(context, intent);
        const secondId = await createPipelineIntent(context, intent);
        expect(firstId).toBeGreaterThan(0);
        expect(secondId).toBeGreaterThan(firstId);

        const runs = await rows(db, 'pipeline_run');
        const steps = await rows(db, 'pipeline_step');
        expect(runs).toHaveLength(2);
        expect(steps).toHaveLength(6);
        expect(runs[0]).toMatchObject({
            id: firstId, slug: 'reconcile', config_name: 'alpha', executed_by: 'operator@example.test',
            cli_version: 'test-version', manifest_checksum: manifestChecksum, transaction_policy: 'pipeline',
            status: 'pending', transaction_outcome: 'pending', started_at: null, finished_at: null,
            duration_ms: 0, active_key: null,
        });
        expect(steps.filter((step) => step['pipeline_run_id'] === firstId)).toEqual([
            expect.objectContaining({
                step_no: 1, name: 'first', filepath: 'first.sql.tmpl', checksum: checksums[0],
                needs: '[]', status: 'pending', transaction_outcome: 'pending',
                started_at: null, finished_at: null, duration_ms: 0,
            }),
            expect.objectContaining({
                step_no: 2, name: 'second', filepath: 'shared.sql', checksum: checksums[1],
                needs: '[1]', status: 'pending', transaction_outcome: 'pending',
                started_at: null, finished_at: null, duration_ms: 0,
            }),
            expect.objectContaining({
                step_no: 3, name: 'third', filepath: 'shared.sql', checksum: checksums[2],
                needs: '[1,2]', status: 'pending', transaction_outcome: 'pending',
                started_at: null, finished_at: null, duration_ms: 0,
            }),
        ]);
        expect(await rows(db, 'change')).toEqual([]);
        expect(await rows(db, 'executions')).toEqual([]);

    });

    it('should roll back the run and earlier step inserts when a later step violates a real constraint', async () => {

        const invalid = { ...intent, steps: [intent.steps[0]!, { ...intent.steps[1]!, name: 'first' }] };
        await expect(createPipelineIntent(context, invalid)).rejects.toThrow();
        expect(await rows(db, 'pipeline_run')).toEqual([]);
        expect(await rows(db, 'pipeline_step')).toEqual([]);

    });

    it('should persist buffered execution and transaction outcomes after a separate workflow rollback', async () => {

        const id = await createPipelineIntent(context, intent);
        await sql`create table workflow_marker (value text not null)`.execute(db);
        await expect(db.transaction().execute(async (trx) => {

            await sql`insert into workflow_marker values ('temporary')`.execute(trx);
            throw new Error('workflow failed');

        })).rejects.toThrow('workflow failed');
        const startedAt = new Date('2026-01-02T03:04:05Z');
        const finishedAt = new Date('2026-01-02T03:04:06Z');
        await finalizePipelineRun(context, id, {
            run: {
                status: 'failed', transaction_outcome: 'rolled_back', started_at: startedAt,
                finished_at: finishedAt, duration_ms: 1000,
                error_message: `é\t\n\r\u0000\u007f\u0085${'x'.repeat(2000)}`,
            },
            steps: [
                {
                    step_no: 1, status: 'success', transaction_outcome: 'rolled_back',
                    started_at: startedAt, finished_at: finishedAt, duration_ms: 300, error_message: '', skip_reason: '',
                },
                {
                    step_no: 2, status: 'failed', transaction_outcome: 'rolled_back',
                    started_at: startedAt, finished_at: finishedAt, duration_ms: 700,
                    error_message: 'workflow failed', skip_reason: '',
                },
                {
                    step_no: 3, status: 'skipped', transaction_outcome: 'not_started',
                    started_at: null, finished_at: null, duration_ms: 0,
                    error_message: '', skip_reason: 'dependency failed',
                },
            ],
        });
        expect((await sql`select * from workflow_marker`.execute(db)).rows).toEqual([]);
        const result = await getPipelineRun(context, id);
        expect(result?.run).toMatchObject({
            id, status: 'failed', transaction_outcome: 'rolled_back', duration_ms: 1000,
            error_message: `é\t\n\r${'x'.repeat(1996)}`,
        });
        expect(result?.steps).toEqual([
            expect.objectContaining({
                step_no: 1, status: 'success', transaction_outcome: 'rolled_back', duration_ms: 300,
            }),
            expect.objectContaining({
                step_no: 2, status: 'failed', transaction_outcome: 'rolled_back', error_message: 'workflow failed',
            }),
            expect.objectContaining({
                step_no: 3, status: 'skipped', transaction_outcome: 'not_started',
                started_at: null, finished_at: null, duration_ms: 0, skip_reason: 'dependency failed',
            }),
        ]);
        expect(await rows(db, 'change')).toEqual([]);
        expect(await rows(db, 'executions')).toEqual([]);

    });

    it('should reject incomplete, duplicate, unexpected and nonterminal step outcomes for a terminal run', async () => {

        const id = await createPipelineIntent(context, intent);
        const run = { status: 'failed' as const, transaction_outcome: 'rolled_back' as const, duration_ms: 10 };
        const steps = [
            { step_no: 1, status: 'success' as const, transaction_outcome: 'rolled_back' as const, duration_ms: 5 },
            { step_no: 2, status: 'failed' as const, transaction_outcome: 'rolled_back' as const, duration_ms: 5 },
            { step_no: 3, status: 'skipped' as const, transaction_outcome: 'not_started' as const, duration_ms: 0 },
        ];
        const invalid = [
            steps.slice(0, 2),
            [steps[0]!, steps[1]!, steps[1]!, steps[2]!],
            [steps[0]!, steps[1]!, { ...steps[2]!, step_no: 4 }],
            [steps[0]!, steps[1]!, { ...steps[2]!, status: 'pending' as const }],
            [steps[0]!, steps[1]!, { ...steps[2]!, status: 'running' as const }],
        ];
        for (const outcomes of invalid) {

            await expect(finalizePipelineRun(context, id, { run, steps: outcomes })).rejects.toThrow();
            const result = await getPipelineRun(context, id);
            expect(result?.run.status).toBe('pending');
            expect(result?.steps.map((step) => step.status)).toEqual(['pending', 'pending', 'pending']);

        }

    });

    it('should allow a running progress flush to update only completed steps', async () => {

        const id = await createPipelineIntent(context, intent);
        await finalizePipelineRun(context, id, {
            run: { status: 'running', transaction_outcome: 'pending', duration_ms: 5 },
            steps: [{ step_no: 1, status: 'success', transaction_outcome: 'pending', duration_ms: 5 }],
        });
        const result = await getPipelineRun(context, id);
        expect(result?.run.status).toBe('running');
        expect(result?.steps.map((step) => step.status)).toEqual(['success', 'pending', 'pending']);

    });

    it('should roll back finalization of both the run and earlier steps on a database error', async () => {

        const id = await createPipelineIntent(context, intent);
        await sql`
            create trigger reject_second_outcome before update on __noorm_pipeline_step__
            when new.step_no = 2 begin select raise(abort, 'reject outcome'); end
        `.execute(db);
        await expect(finalizePipelineRun(context, id, {
            run: { status: 'failed', transaction_outcome: 'rolled_back', duration_ms: 10 },
            steps: [
                { step_no: 1, status: 'success', transaction_outcome: 'rolled_back', duration_ms: 5 },
                { step_no: 2, status: 'failed', transaction_outcome: 'rolled_back', duration_ms: 5 },
                { step_no: 3, status: 'skipped', transaction_outcome: 'not_started', duration_ms: 0 },
            ],
        })).rejects.toThrow('reject outcome');
        const result = await getPipelineRun(context, id);
        expect(result?.run).toMatchObject({ status: 'pending', transaction_outcome: 'pending', duration_ms: 0 });
        expect(result?.steps.map((step) => [step.status, step.transaction_outcome, step.duration_ms])).toEqual([
            ['pending', 'pending', 0], ['pending', 'pending', 0], ['pending', 'pending', 0],
        ]);

    });

    it('should bound and order history within the selected config and slug', async () => {

        const ids: number[] = [];
        for (let i = 0; i < 23; i++) ids.push(await createPipelineIntent(context, intent));
        const foreign = { ...context, configName: 'beta' };
        const foreignId = await createPipelineIntent(foreign, intent);
        await createPipelineIntent(context, { ...intent, slug: 'other' });
        expect(await getPipelineRun(context, foreignId)).toBeNull();
        expect(await getPipelineRun(foreign, ids[0]!)).toBeNull();
        expect((await getPipelineRun(context, ids[0]!))?.run.id).toBe(ids[0]);
        const descending = [...ids].reverse();
        expect((await listPipelineHistory(context, 'reconcile')).map((run) => run.id)).toEqual(descending.slice(0, 20));
        expect((await listPipelineHistory(context, 'reconcile', { limit: 1 })).map((run) => run.id))
            .toEqual(descending.slice(0, 1));
        expect((await listPipelineHistory(context, 'reconcile', { limit: 100 })).map((run) => run.id))
            .toEqual(descending);
        expect((await listPipelineHistory(foreign, 'reconcile')).map((run) => run.id)).toEqual([foreignId]);
        expect(await listPipelineHistory(context, 'missing')).toEqual([]);

    });

    it('should claim an active key atomically and reject finalization from another config', async () => {

        const key = 'e'.repeat(64);
        const id = await createPipelineIntent(context, { ...intent, singleRun: true, activeKey: key });
        await expect(createPipelineIntent(context, { ...intent, singleRun: true, activeKey: key })).rejects.toThrow();
        expect(await rows(db, 'pipeline_run')).toHaveLength(1);
        expect(await rows(db, 'pipeline_step')).toHaveLength(3);
        await expect(finalizePipelineRun({ ...context, configName: 'foreign' }, id, {
            run: { status: 'failed', transaction_outcome: 'unknown', duration_ms: 1 },
            steps: [{ step_no: 1, status: 'failed', transaction_outcome: 'unknown', duration_ms: 1 }],
        })).rejects.toThrow();
        expect((await getPipelineRun(context, id))?.run).toMatchObject({ status: 'pending', active_key: key });
        expect((await getPipelineRun(context, id))?.steps[0]?.status).toBe('pending');

    });

    it('should reject invalid limits and run IDs instead of silently coercing or widening queries', async () => {

        for (const limit of [0, -1, 101, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {

            await expect(listPipelineHistory(context, 'reconcile', { limit })).rejects.toThrow();

        }
        for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {

            await expect(getPipelineRun(context, id)).rejects.toThrow();

        }
        expect(await getPipelineRun(context, Number.MAX_SAFE_INTEGER)).toBeNull();

    });

});
