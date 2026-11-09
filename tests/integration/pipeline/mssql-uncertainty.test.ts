import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql, type DatabaseConnection, type KyselyPlugin } from 'kysely';
import { PipelineBusyError } from '../../../src/core/pipeline/admission.js';
import { runPipeline } from '../../../src/core/pipeline/executor.js';
import { getPipelineRun } from '../../../src/core/pipeline/history.js';
import type { PipelineContext } from '../../../src/core/pipeline/types.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';
import { withPipelineDatabase } from '../../utils/pipeline-db.js';

interface NativeConnection extends DatabaseConnection {
    commitTransaction(): Promise<void>;
    rollbackTransaction(savepointName?: string): Promise<void>;
}

type SessionState = { transaction_count: number; transaction_state: number; marker_count: number };

// The driver's public connection prototype is shared by all pools in a process.
// Isolating this suite keeps its temporary wrappers out of other tests.
if (!process.env['PIPELINE_MSSQL_UNCERTAINTY_CHILD']) {

    it('exercises native MSSQL uncertainty in an isolated process', async () => {

        const env = { ...process.env, PIPELINE_MSSQL_UNCERTAINTY_CHILD: '1' };
        const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
            cwd: resolve(import.meta.dir, '../../..'), env, stdout: 'pipe', stderr: 'pipe',
        });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
        ]);
        expect({ exitCode, output: exitCode === 0 ? '' : stdout + stderr }).toEqual({ exitCode: 0, output: '' });

    }, 180_000);

}
else {

    describe('MSSQL native transaction uncertainty', () => {

        for (const fault of ['commit-ack', 'rollback-ack', 'rollback-before'] as const) {

            it(`preserves effects, outcome and activity independently: ${fault}`, async () => {

                await withPipelineDatabase('mssql', async ({ db, connection }) => {

                    const root = await mkdtemp(join(tmpdir(), 'noorm-mssql-uncertainty-'));
                    try {

                        await bootstrapSchema(db, 'mssql');
                        await sql`CREATE TABLE marker (value VARCHAR(20) NOT NULL)`.execute(db);
                        const folder = join(root, 'db', 'pipelines', 'refresh');
                        await mkdir(folder, { recursive: true });
                        const steps = [{ id: 'first', sql: 'a.sql' }];
                        if (fault !== 'commit-ack') steps.push({ id: 'failure', sql: 'b.sql' });
                        await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({
                            transaction: 'pipeline', singleRun: true, steps,
                        }));
                        await writeFile(join(folder, 'a.sql'), "INSERT INTO marker VALUES ('A')");
                        await writeFile(join(folder, 'b.sql'), 'SELECT * FROM missing_pipeline_table');

                        let armed = false;
                        let injected = false;
                        let nativeRollbackFailed = false;
                        let busyError: unknown;
                        let rootUsable = false;
                        let beforeFault: SessionState | undefined;
                        let afterBusy: SessionState | undefined;
                        const plugin: KyselyPlugin = {
                            transformQuery(args) {

                                if (args.node.kind === 'RawNode'
                                    && args.node.sqlFragments.join('').includes('INSERT INTO marker')) armed = true;

                                return args.node;

                            },
                            async transformResult(args) {

                                return args.result;

                            },
                        };
                        const context: PipelineContext = {
                            db: db.withPlugin(plugin), dialect: 'mssql', connectionConfig: connection,
                            configName: 'alpha', identity: { name: 'test', source: 'config' }, projectRoot: root,
                            access: { user: 'admin', agent: 'admin' }, channel: 'user',
                            pipelinesPath: './db/pipelines', cliVersion: 'test',
                        };
                        const stateQuery = sql<SessionState>`
                            DECLARE @count int = @@TRANCOUNT, @state int = XACT_STATE();
                            SELECT @count AS transaction_count, @state AS transaction_state,
                                (SELECT COUNT(*) FROM marker) AS marker_count
                        `.compile(db);
                        const state = async (session: NativeConnection) => (await session.executeQuery<SessionState>(stateQuery)).rows[0]!;
                        const prototype = await db.getExecutor().provideConnection(async (session) => {

                            if (!('commitTransaction' in session) || typeof session.commitTransaction !== 'function'
                                || !('rollbackTransaction' in session) || typeof session.rollbackTransaction !== 'function') {

                                throw new Error('Expected native MSSQL transaction controls');

                            }

                            return Object.getPrototypeOf(session) as NativeConnection;

                        });
                        const commit = prototype.commitTransaction;
                        const rollback = prototype.rollbackTransaction;
                        prototype.commitTransaction = async function (this: NativeConnection) {

                            if (fault !== 'commit-ack' || !armed) return commit.call(this);
                            armed = false;
                            await commit.call(this);
                            beforeFault = await state(this);
                            injected = true;
                            throw new Error('native commit acknowledgement lost');

                        };
                        prototype.rollbackTransaction = async function (this: NativeConnection, savepointName?: string) {

                            if (fault === 'commit-ack' && injected) {

                                try {

                                    return await rollback.call(this, savepointName);

                                }
                                catch (error) {

                                    nativeRollbackFailed = true; throw error;

                                }

                            }
                            if (!armed || fault === 'commit-ack') return rollback.call(this, savepointName);
                            armed = false;
                            if (fault === 'rollback-before') {

                                beforeFault = await state(this);
                                try {

                                    await runPipeline(context, 'refresh');

                                }
                                catch (error) {

                                    busyError = error;

                                }
                                const rootResult = await sql<{ answer: number }>`SELECT 1 AS answer`.execute(db);
                                rootUsable = rootResult.rows[0]?.answer === 1;
                                afterBusy = await state(this);

                            }
                            else {

                                await rollback.call(this, savepointName);
                                beforeFault = await state(this);

                            }
                            injected = true;
                            throw new Error(`native ${fault} failure`);

                        };
                        let result;
                        try {

                            result = await runPipeline(context, 'refresh');

                        }
                        finally {

                            prototype.commitTransaction = commit;
                            prototype.rollbackTransaction = rollback;

                        }
                        if (result.dryRun) throw new Error('Expected admitted execution');
                        expect(injected).toBe(true);
                        expect(result.status).toBe('unknown');
                        expect(result.transactionOutcome).toBe('unknown');
                        expect(result.steps.map((step) => step.transactionOutcome)).toEqual(steps.map(() => 'unknown'));
                        if (fault === 'commit-ack') {

                            expect(result.primaryError).toMatchObject({ phase: 'commit' });
                            if (nativeRollbackFailed) {

                                expect(result.secondaryErrors).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'rollback' })]));

                            }
                            expect(beforeFault).toEqual({ transaction_count: 0, transaction_state: 0, marker_count: 1 });

                        }
                        else {

                            expect(result.primaryError).toMatchObject({ phase: 'execute', stepNo: 2 });
                            expect(result.secondaryErrors).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'rollback' })]));
                            if (fault === 'rollback-ack') {

                                expect(beforeFault).toEqual({ transaction_count: 0, transaction_state: 0, marker_count: 0 });

                            }
                            else {

                                expect(beforeFault).toEqual({ transaction_count: 1, transaction_state: 1, marker_count: 1 });
                                expect(afterBusy).toEqual(beforeFault);
                                expect(busyError).toBeInstanceOf(PipelineBusyError);
                                expect(rootUsable).toBe(true);

                            }

                        }
                        const markers = await sql<{ value: string }>`SELECT value FROM marker ORDER BY value`.execute(db);
                        expect(markers.rows).toEqual(fault === 'commit-ack' ? [{ value: 'A' }] : []);
                        const saved = await getPipelineRun({
                            db, dialect: 'mssql', configName: 'alpha', executedBy: 'test', cliVersion: 'test',
                        }, result.runId);
                        expect(saved).not.toBeNull();
                        if (fault === 'rollback-before') {

                            expect(saved!.run.status).toBe('pending');
                            expect(saved!.run.active_key).not.toBeNull();
                            await expect(runPipeline(context, 'refresh')).rejects.toBeInstanceOf(PipelineBusyError);
                            expect((await sql`SELECT value FROM marker`.execute(db)).rows).toEqual([]);

                        }
                        else {

                            expect(saved!.run).toMatchObject({ status: 'unknown', transaction_outcome: 'unknown', active_key: null });
                            expect(saved!.steps.map((step) => step.transaction_outcome)).toEqual(steps.map(() => 'unknown'));

                        }

                    }
                    finally {

                        await rm(root, { recursive: true, force: true });

                    }

                });

            }, 60_000);

        }

    });

}
