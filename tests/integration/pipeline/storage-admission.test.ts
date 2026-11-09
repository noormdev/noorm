import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { Dialect } from '../../../src/core/connection/types.js';
import { admitPipelineRun, PipelineBusyError, releasePipelineAdmission } from '../../../src/core/pipeline/admission.js';
import { getPipelineRun, type PipelineHistoryContext, type PipelineIntent } from '../../../src/core/pipeline/history.js';
import { runPipeline } from '../../../src/core/pipeline/executor.js';
import type { PipelineContext } from '../../../src/core/pipeline/types.js';
import { Tracker, decideNeedsRun } from '../../../src/core/runner/tracker.js';
import { getNoormTables, type NoormDatabase } from '../../../src/core/shared/tables.js';
import { teardownSchema, truncateData } from '../../../src/core/teardown/operations.js';
import { planTransfer } from '../../../src/core/transfer/planner.js';
import { bootstrapSchema, getSchemaVersion, migrateSchema } from '../../../src/core/version/schema/index.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { v2 } from '../../../src/core/version/schema/migrations/v2.js';
import { v3 } from '../../../src/core/version/schema/migrations/v3.js';
import { makeTestConfig } from '../../utils/db.js';
import { withPipelineDatabase } from '../../utils/pipeline-db.js';

const dialects: Dialect[] = ['sqlite', 'postgres', 'mysql', 'mssql'];
const intent: PipelineIntent = {
    slug: 'refresh', transaction: 'step', singleRun: true, manifestChecksum: 'a'.repeat(64),
    steps: [
        { stepNo: 1, name: 'load', filepath: 'load.sql', checksum: 'b'.repeat(64), needs: [] },
        { stepNo: 2, name: 'finish', filepath: 'finish.sql', checksum: 'c'.repeat(64), needs: [1] },
    ],
};
function table(dialect: Dialect, name: string) {

    return sql.table(dialect === 'postgres' || dialect === 'mssql' ? `noorm.${name}` : name);

}
function historyContext(db: Kysely<NoormDatabase>, dialect: Dialect): PipelineHistoryContext {

    return { db, dialect, configName: 'alpha', executedBy: 'test', cliVersion: 'test' };

}
async function insertStep(db: Kysely<NoormDatabase>, dialect: Dialect, id: number, stepNo: number, name: string) {

    const step = table(dialect, getNoormTables(dialect).pipelineStep);
    await sql`INSERT INTO ${step} (pipeline_run_id, step_no, name, filepath, checksum, needs, status, transaction_outcome)
        VALUES (${id}, ${stepNo}, ${name}, ${'step.sql'}, ${'b'.repeat(64)}, ${'[]'}, ${'pending'}, ${'pending'})`.execute(db);

}

for (const dialect of dialects) {

    describe(`pipeline storage acceptance: ${dialect}`, () => {

        it('upgrades v2 without losing generic records, and resets v3 independently', async () => {

            await withPipelineDatabase(dialect, async ({ db, untypedDb }) => {

                await v1.up(untypedDb, dialect);
                await v2.up(untypedDb, dialect);
                const names = getNoormTables(dialect);
                const version = table(dialect, names.version);
                const change = table(dialect, names.change);
                await sql`INSERT INTO ${version} (cli_version, noorm_version, state_version, settings_version) VALUES (${'old'}, ${2}, ${1}, ${1})`.execute(db);
                await sql`INSERT INTO ${change} (name, change_type, direction, status) VALUES (${'existing'}, ${'change'}, ${'change'}, ${'success'})`.execute(db);
                await migrateSchema(db, dialect);
                expect(await getSchemaVersion(db, dialect)).toBe(3);
                const ctx = historyContext(db, dialect);
                await admitPipelineRun(ctx, intent);
                await v3.down(untypedDb, dialect);
                await expect(sql`SELECT * FROM ${table(dialect, names.pipelineRun)}`.execute(db)).rejects.toThrow();
                await expect(sql`SELECT * FROM ${table(dialect, names.pipelineStep)}`.execute(db)).rejects.toThrow();
                await v3.up(untypedDb, dialect);
                expect((await sql`SELECT * FROM ${table(dialect, names.pipelineRun)}`.execute(db)).rows).toHaveLength(0);
                expect((await sql`SELECT * FROM ${table(dialect, names.pipelineStep)}`.execute(db)).rows).toHaveLength(0);
                expect((await sql`SELECT * FROM ${change} WHERE name = ${'existing'}`.execute(db)).rows).toHaveLength(1);

            });

        }, 60_000);

        it('bootstraps constraints and atomically admits only one protected pending owner', async () => {

            await withPipelineDatabase(dialect, async ({ db }) => {

                await bootstrapSchema(db, dialect);
                expect(await getSchemaVersion(db, dialect)).toBe(3);
                const ctx = historyContext(db, dialect);
                const names = getNoormTables(dialect);
                for (const name of Object.values(names)) {

                    await sql`SELECT * FROM ${table(dialect, name)}`.execute(db);

                }
                if (dialect === 'sqlite') {

                    expect(names.pipelineRun).toBe('__noorm_pipeline_run__');
                    expect(names.pipelineStep).toBe('__noorm_pipeline_step__');

                }
                if (dialect === 'postgres') {

                    expect(names.pipelineRun).toBe('pipeline_run');
                    expect(names.pipelineStep).toBe('pipeline_step');

                }
                const attempts = await Promise.allSettled([admitPipelineRun(ctx, intent), admitPipelineRun(ctx, intent)]);
                const owners = attempts.filter((r) => r.status === 'fulfilled');
                const busy = attempts.filter((r) => r.status === 'rejected');
                expect(owners).toHaveLength(1);
                expect(busy).toHaveLength(1);
                if (owners[0]?.status !== 'fulfilled' || busy[0]?.status !== 'rejected') throw new Error('unexpected admission results');
                expect(busy[0].reason).toBeInstanceOf(PipelineBusyError);
                const owner = owners[0].value;
                const run = table(dialect, names.pipelineRun);
                const step = table(dialect, names.pipelineStep);
                expect((await sql`SELECT * FROM ${run}`.execute(db)).rows).toHaveLength(1);
                expect((await sql`SELECT * FROM ${step}`.execute(db)).rows).toHaveLength(2);
                const record = await getPipelineRun(ctx, owner.runId);
                expect(record?.run.status).toBe('pending');
                expect(JSON.parse(record!.steps[1]!.needs)).toEqual([1]);
                await expect(insertStep(db, dialect, owner.runId, 1, 'duplicate-number')).rejects.toThrow();
                await expect(insertStep(db, dialect, owner.runId, 3, 'load')).rejects.toThrow();
                await expect(insertStep(db, dialect, 99999999, 1, 'orphan')).rejects.toThrow();
                const slug = await admitPipelineRun(ctx, { ...intent, slug: 'other' });
                const config = await admitPipelineRun({ ...ctx, configName: 'beta' }, intent);
                const free1 = await admitPipelineRun(ctx, { ...intent, singleRun: false });
                const free2 = await admitPipelineRun(ctx, { ...intent, singleRun: false });
                expect(new Set([owner.activeKey, slug.activeKey, config.activeKey]).size).toBe(3);
                expect([free1.activeKey, free2.activeKey]).toEqual([null, null]);
                expect(await releasePipelineAdmission(ctx, owner, { activitySettled: false })).toBe(false);
                expect(await releasePipelineAdmission(ctx, { ...owner, runId: owner.runId + 999 }, { activitySettled: true })).toBe(false);
                expect(await releasePipelineAdmission(ctx, { ...owner, activeKey: 'wrong' }, { activitySettled: true })).toBe(false);
                expect(await releasePipelineAdmission({ ...ctx, configName: 'beta' }, owner, { activitySettled: true })).toBe(false);
                expect((await getPipelineRun(ctx, owner.runId))?.run.active_key).toBe(owner.activeKey);
                await expect(admitPipelineRun(ctx, intent)).rejects.toBeInstanceOf(PipelineBusyError);
                expect(await releasePipelineAdmission(ctx, owner, { activitySettled: true })).toBe(true);
                const next = await admitPipelineRun(ctx, intent);
                expect(next.activeKey).toBe(owner.activeKey);
                await sql`DELETE FROM ${run} WHERE id = ${owner.runId}`.execute(db);
                expect((await sql`SELECT * FROM ${step} WHERE pipeline_run_id = ${owner.runId}`.execute(db)).rows).toHaveLength(0);
                expect((await sql`SELECT * FROM ${step} WHERE pipeline_run_id = ${slug.runId}`.execute(db)).rows).toHaveLength(2);

            });

        }, 60_000);

        it('keeps generic applied state and pipeline history independent across rollback', async () => {

            await withPipelineDatabase(dialect, async ({ db, connection }) => {

                await bootstrapSchema(db, dialect);
                const ctx = historyContext(db, dialect);
                const tracker = new Tracker(db, 'alpha', dialect);
                const filepath = 'load.sql';
                const checksum = 'b'.repeat(64);
                const [empty, emptyError] = await tracker.latestExecutions();
                expect(emptyError).toBeNull();
                expect(decideNeedsRun(empty!.get(filepath), checksum, false).needsRun).toBe(true);
                const admitted = await admitPipelineRun(ctx, intent);
                const [afterPipeline, pipelineError] = await tracker.latestExecutions();
                expect(pipelineError).toBeNull();
                expect(decideNeedsRun(afterPipeline!.get(filepath), checksum, false).needsRun).toBe(true);
                const op = await tracker.createOperation({ name: 'build', changeType: 'build', configName: 'alpha', executedBy: 'test' });
                expect(await tracker.createFileRecords(op, [{ filepath, fileType: 'sql', checksum }])).toBeNull();
                expect(await tracker.updateFileExecution(op, filepath, 'success', 1)).toBeNull();
                expect(await tracker.finalizeOperation(op, 'success', 1)).toBeNull();
                const [latest, latestError] = await tracker.latestExecutions();
                expect(latestError).toBeNull();
                expect(decideNeedsRun(latest!.get(filepath), checksum, false).needsRun).toBe(false);
                expect((await getPipelineRun(ctx, admitted.runId))?.steps).toHaveLength(2);
                await sql`CREATE TABLE workflow_marker (marker_id INTEGER NOT NULL)`.execute(db);
                await expect(db.transaction().execute(async (trx) => {

                    await sql`INSERT INTO workflow_marker VALUES (1)`.execute(trx);
                    throw new Error('rollback workflow');

                })).rejects.toThrow();
                expect((await sql`SELECT * FROM workflow_marker`.execute(db)).rows).toHaveLength(0);
                expect((await getPipelineRun(ctx, admitted.runId))?.steps).toHaveLength(2);
                const root = await mkdtemp(join(tmpdir(), 'noorm-pipeline-independent-'));
                try {

                    const folder = join(root, 'db', 'pipelines', 'refresh');
                    await mkdir(folder, { recursive: true });
                    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({ transaction: 'step', steps: [{ id: 'load', sql: 'load.sql' }] }));
                    await writeFile(join(folder, 'load.sql'), 'INSERT INTO workflow_marker VALUES (2)');
                    const context: PipelineContext = { db, dialect, connectionConfig: connection, configName: 'alpha', identity: { name: 'test', source: 'config' }, projectRoot: root, access: { user: 'admin', agent: 'admin' }, channel: 'user', pipelinesPath: './db/pipelines', cliVersion: 'test' };
                    const result = await runPipeline(context, 'refresh');
                    expect(result.status).toBe('success');
                    expect(result.runId).not.toBe(admitted.runId);
                    expect((await sql`SELECT * FROM workflow_marker`.execute(db)).rows).toHaveLength(1);

                }
                finally {

                    await rm(root, { recursive: true, force: true });

                }
                const names = getNoormTables(dialect);
                expect((await sql`SELECT * FROM ${table(dialect, names.change)}`.execute(db)).rows).toHaveLength(1);
                expect((await sql`SELECT * FROM ${table(dialect, names.executions)}`.execute(db)).rows).toHaveLength(1);

            });

        }, 60_000);

        it('excludes pipeline history from transfer, truncation and teardown', async () => {

            await withPipelineDatabase(dialect, async ({ db, untypedDb, connection }) => {

                await bootstrapSchema(db, dialect);
                const ctx = historyContext(db, dialect);
                const admitted = await admitPipelineRun(ctx, intent);
                await sql`CREATE TABLE application_data (id INTEGER PRIMARY KEY)`.execute(db);
                const change = table(dialect, getNoormTables(dialect).change);
                await sql`INSERT INTO ${change} (name, change_type, direction, status) VALUES (${'existing'}, ${'change'}, ${'change'}, ${'success'})`.execute(db);
                await sql`INSERT INTO application_data VALUES (1)`.execute(db);
                const source = { db, dialect, config: makeTestConfig('pipeline-source', connection) };
                if (dialect === 'sqlite') {

                    const [plan, error] = await planTransfer({ source, destination: source });
                    expect(plan).toBeNull();
                    expect(error).not.toBeNull();

                }
                else {

                    const [plan, error] = await planTransfer({ source, destination: source });
                    expect(error).toBeNull();
                    const names = plan!.tables.map((item) => item.name);
                    expect(names).toContain('application_data');
                    expect(names).not.toContain(getNoormTables(dialect).pipelineRun);
                    expect(names).not.toContain(getNoormTables(dialect).pipelineStep);

                }
                await truncateData(untypedDb, dialect);
                expect((await sql`SELECT * FROM application_data`.execute(db)).rows).toHaveLength(0);
                await teardownSchema(untypedDb, dialect);
                await expect(sql`SELECT * FROM application_data`.execute(db)).rejects.toThrow();
                expect((await getPipelineRun(ctx, admitted.runId))?.steps).toHaveLength(2);
                expect((await sql`SELECT * FROM ${change} WHERE name = ${'existing'}`.execute(db)).rows).toHaveLength(1);

            }, { sqliteFile: true });

        }, 60_000);

        it('reports terminal audit failure after committed SQL and releases settled ownership', async () => {

            await withPipelineDatabase(dialect, async ({ db, connection }) => {

                await bootstrapSchema(db, dialect);
                await sql`CREATE TABLE workflow_marker (marker_id INTEGER NOT NULL)`.execute(db);
                if (dialect === 'sqlite') {

                    await sql.raw("CREATE TRIGGER fail_pipeline_success BEFORE UPDATE ON __noorm_pipeline_run__ WHEN NEW.status = 'success' AND OLD.status <> 'success' BEGIN SELECT RAISE(ABORT, 'audit failure'); END").execute(db);

                }
                else if (dialect === 'postgres') {

                    await sql.raw("CREATE FUNCTION noorm.fail_pipeline_success() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'success' AND OLD.status <> 'success' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$").execute(db);
                    await sql.raw('CREATE TRIGGER fail_pipeline_success BEFORE UPDATE ON noorm.pipeline_run FOR EACH ROW EXECUTE FUNCTION noorm.fail_pipeline_success()').execute(db);

                }
                else if (dialect === 'mysql') {

                    await sql.raw("CREATE TRIGGER fail_pipeline_success BEFORE UPDATE ON __noorm_pipeline_run__ FOR EACH ROW BEGIN IF NEW.status = 'success' AND OLD.status <> 'success' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit failure'; END IF; END").execute(db);

                }
                else {

                    await sql.raw("CREATE TRIGGER noorm.fail_pipeline_success ON noorm.pipeline_run AFTER UPDATE AS BEGIN IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id WHERE i.status = 'success' AND d.status <> 'success') BEGIN ;THROW 50001, 'audit failure', 1; END END").execute(db);

                }
                const root = await mkdtemp(join(tmpdir(), 'noorm-pipeline-audit-'));
                try {

                    const folder = join(root, 'db', 'pipelines', 'refresh');
                    await mkdir(folder, { recursive: true });
                    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({ transaction: 'step', singleRun: true, steps: [{ id: 'load', sql: 'load.sql' }] }));
                    await writeFile(join(folder, 'load.sql'), 'INSERT INTO workflow_marker VALUES (1)');
                    const context: PipelineContext = { db, dialect, connectionConfig: connection, configName: 'alpha', identity: { name: 'test', source: 'config' }, projectRoot: root, access: { user: 'admin', agent: 'admin' }, channel: 'user', pipelinesPath: './db/pipelines', cliVersion: 'test' };
                    const result = await runPipeline(context, 'refresh', {});
                    if (result.dryRun) throw new Error('unexpected dry run');
                    expect(result.status).not.toBe('success');
                    expect(result.transactionOutcome).toBe('committed');
                    expect(result.steps[0]?.transactionOutcome).toBe('committed');
                    expect([result.primaryError, ...result.secondaryErrors].some((error) => error?.phase === 'audit')).toBe(true);
                    expect((await sql`SELECT * FROM workflow_marker`.execute(db)).rows).toHaveLength(1);
                    const record = await getPipelineRun(historyContext(db, dialect), result.runId);
                    expect(record).not.toBeNull();
                    expect(record!.run.active_key).toBeNull();

                }
                finally {

                    await rm(root, { recursive: true, force: true });

                }

            });

        }, 60_000);

    });

}
