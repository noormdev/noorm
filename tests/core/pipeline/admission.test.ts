import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Kysely, SqliteDialect, sql } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import {
    admitPipelineRun, PipelineBusyError, releasePipelineAdmission,
} from '../../../src/core/pipeline/admission.js';
import { getPipelineRun } from '../../../src/core/pipeline/history.js';
import type { PipelineHistoryContext, PipelineIntent } from '../../../src/core/pipeline/history.js';
import type { NoormDatabase } from '../../../src/core/shared/tables.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';

const intent: Omit<PipelineIntent, 'activeKey'> = {
    slug: 'reconcile', manifestChecksum: 'a'.repeat(64), transaction: 'step', singleRun: true,
    steps: [
        { stepNo: 1, name: 'first', filepath: 'first.sql', checksum: 'b'.repeat(64), needs: [] },
        { stepNo: 2, name: 'second', filepath: 'second.sql', checksum: 'c'.repeat(64), needs: [1] },
    ],
};

describe('pipeline: admission', () => {

    let db: Kysely<NoormDatabase>;
    let context: PipelineHistoryContext;

    beforeEach(async () => {

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({ database: new BunSqliteDatabase(':memory:') as never }),
        });
        await bootstrapSchema(db, 'sqlite');
        context = { db, dialect: 'sqlite', configName: 'alpha', executedBy: 'operator', cliVersion: 'test' };

    });

    afterEach(async () => {

        await db.destroy();

    });

    it('should claim the canonical key atomically and reject a pending collision without history', async () => {

        const admission = await admitPipelineRun(context, { ...intent, activeKey: null } as PipelineIntent);
        expect(admission.activeKey).toBe(createHash('sha256').update(JSON.stringify(['alpha', 'reconcile'])).digest('hex'));
        const record = await getPipelineRun(context, admission.runId);
        expect(record?.run.status).toBe('pending');
        expect(record?.run.active_key).toBe(admission.activeKey);
        expect(record?.steps).toHaveLength(2);
        await expect(admitPipelineRun(context, intent)).rejects.toBeInstanceOf(PipelineBusyError);
        const runs = await sql`select * from __noorm_pipeline_run__`.execute(db);
        const steps = await sql`select * from __noorm_pipeline_step__`.execute(db);
        expect(runs.rows).toHaveLength(1);
        expect(steps.rows).toHaveLength(2);

    });

    it('should serialize concurrent claims on one handle', async () => {

        const results = await Promise.allSettled([admitPipelineRun(context, intent), admitPipelineRun(context, intent)]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((result) => result.status === 'rejected');
        expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(PipelineBusyError);
        expect((await sql`select * from __noorm_pipeline_run__`.execute(db)).rows).toHaveLength(1);
        expect((await sql`select * from __noorm_pipeline_step__`.execute(db)).rows).toHaveLength(2);

    });

    it('should allow different keys and multiple unprotected runs', async () => {

        const first = await admitPipelineRun(context, intent);
        const otherSlug = await admitPipelineRun(context, { ...intent, slug: 'other' });
        const otherConfig = await admitPipelineRun({ ...context, configName: 'beta' }, intent);
        const unprotected = { ...intent, singleRun: false, activeKey: 'injected' };
        const a = await admitPipelineRun(context, unprotected);
        const b = await admitPipelineRun(context, unprotected);
        expect(new Set([first.activeKey, otherSlug.activeKey, otherConfig.activeKey]).size).toBe(3);
        expect(a.activeKey).toBeNull();
        expect(b.activeKey).toBeNull();
        expect((await sql`select * from __noorm_pipeline_run__`.execute(db)).rows).toHaveLength(5);

    });

    it('should retain ownership unless settled and both key and resolved config match', async () => {

        const admission = await admitPipelineRun(context, intent);
        expect(await releasePipelineAdmission(context, admission, { activitySettled: false })).toBe(false);
        expect(await releasePipelineAdmission(context, { ...admission, runId: admission.runId + 1 }, { activitySettled: true })).toBe(false);
        expect(await releasePipelineAdmission(context, { ...admission, activeKey: 'wrong' }, { activitySettled: true })).toBe(false);
        expect(await releasePipelineAdmission({ ...context, configName: 'beta' }, admission, { activitySettled: true })).toBe(false);
        expect((await getPipelineRun(context, admission.runId))?.run.active_key).toBe(admission.activeKey);
        await expect(admitPipelineRun(context, intent)).rejects.toBeInstanceOf(PipelineBusyError);
        expect(await releasePipelineAdmission(context, admission, { activitySettled: true })).toBe(true);
        expect(await releasePipelineAdmission(context, admission, { activitySettled: true })).toBe(false);
        const next = await admitPipelineRun(context, intent);
        expect(next.runId).not.toBe(admission.runId);
        expect(next.activeKey).toBe(admission.activeKey);
        const free = await admitPipelineRun(context, { ...intent, singleRun: false });
        expect(await releasePipelineAdmission(context, free, { activitySettled: true })).toBe(false);

    });

    it('should roll back a non-guard step constraint failure without reporting busy', async () => {

        const invalid = { ...intent, steps: [intent.steps[0]!, { ...intent.steps[1]!, name: 'first' }] };
        let caught: unknown;
        try {

            await admitPipelineRun(context, invalid);

        }
        catch (error) {

            caught = error;

        }
        expect(caught).toBeInstanceOf(Error);
        expect(caught).not.toBeInstanceOf(PipelineBusyError);
        expect((await sql`select * from __noorm_pipeline_run__`.execute(db)).rows).toHaveLength(0);
        expect((await sql`select * from __noorm_pipeline_step__`.execute(db)).rows).toHaveLength(0);
        expect((await admitPipelineRun(context, intent)).activeKey).not.toBeNull();

    });

});
