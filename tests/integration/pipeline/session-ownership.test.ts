import { expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type KyselyPlugin } from 'kysely';
import { createConnection } from '../../../src/core/connection/factory.js';
import type { ConnectionResult } from '../../../src/core/connection/types.js';
import { PipelineBusyError } from '../../../src/core/pipeline/admission.js';
import { runPipeline } from '../../../src/core/pipeline/executor.js';
import { getPipelineRun } from '../../../src/core/pipeline/history.js';
import type { PipelineContext } from '../../../src/core/pipeline/types.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';
import { withPipelineDatabase } from '../../utils/pipeline-db.js';
import { withPolicy } from '../../utils/access.js';

it('isolates an unsettled MySQL rollback from root bookkeeping and later workflow commits', async () => {

    await withPipelineDatabase('mysql', async ({ db, connection }) => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-owned-session-'));
        let observer: ConnectionResult | undefined;
        try {

            observer = await createConnection(connection, 'pipeline-observer', { retries: 1, delay: 0 });
            await bootstrapSchema(db, 'mysql');
            await sql`CREATE TABLE marker (value VARCHAR(20) NOT NULL)`.execute(db);
            const folder = join(root, 'db', 'pipelines', 'refresh');
            const other = join(root, 'db', 'pipelines', 'other');
            await mkdir(folder, { recursive: true });
            await mkdir(other, { recursive: true });
            await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({ transaction: 'pipeline', singleRun: true,
                steps: [{ id: 'first', sql: 'a.sql' }, { id: 'failure', sql: 'b.sql' }] }));
            await writeFile(join(folder, 'a.sql'), "INSERT INTO marker VALUES ('A')");
            await writeFile(join(folder, 'b.sql'), 'SELECT * FROM missing_pipeline_table');
            await writeFile(join(other, 'pipeline.yml'), JSON.stringify({ transaction: 'pipeline', singleRun: true,
                steps: [{ id: 'other', sql: 'other.sql' }] }));
            await writeFile(join(other, 'other.sql'), "INSERT INTO marker VALUES ('B')");
            let armed = false;
            const plugin: KyselyPlugin = {
                transformQuery(args) {

                    if (args.node.kind === 'RawNode') {

                        const text = args.node.sqlFragments.join('').trim().toLowerCase();
                        if (text.includes('insert into marker')) armed = true;
                        if (armed && text === 'rollback') {

                            armed = false;
                            throw new Error('rollback failed before reaching the server');

                        }

                    }

                    return args.node;

                },
                async transformResult(args) {

                    return args.result;

                },
            };
            const context: PipelineContext = { db: db.withPlugin(plugin), dialect: 'mysql', connectionConfig: connection,
                configName: 'alpha', identity: { name: 'test', source: 'config' }, projectRoot: root,
                access: withPolicy({ user: 'admin', agent: 'admin' }), channel: 'user',
                pipelinesPath: './db/pipelines', cliVersion: 'test' };
            const first = await runPipeline(context, 'refresh');
            if (first.dryRun) throw new Error('expected admitted execution');
            expect(first.primaryError).toMatchObject({ phase: 'execute', stepNo: 2 });
            expect(first.secondaryErrors).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'rollback' })]));
            const readMarkers = async () => (await sql<{ value: string }>`SELECT value FROM marker ORDER BY value`.execute(observer!.db)).rows;
            expect(await readMarkers()).toEqual([]);
            await expect(runPipeline(context, 'refresh')).rejects.toBeInstanceOf(PipelineBusyError);
            await sql`SELECT 1`.execute(db);
            expect(await readMarkers()).toEqual([]);
            const history = await getPipelineRun({ db, dialect: 'mysql', configName: 'alpha', executedBy: 'test', cliVersion: 'test' }, first.runId);
            expect(history!.run.status).toBe('pending');
            expect(history!.run.active_key).not.toBeNull();
            const next = await runPipeline(context, 'other');
            expect(next.status).toBe('success');
            expect(await readMarkers()).toEqual([{ value: 'B' }]);

        }
        finally {

            try {

                if (observer) await observer.destroy();

            }
            finally {

                await rm(root, { recursive: true, force: true });

            }

        }

    });

}, 60_000);

it('releases a protected run when its owned MySQL pool cannot open', async () => {

    await withPipelineDatabase('mysql', async ({ db, connection }) => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-pool-open-'));
        const user = `np_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
        const password = randomUUID().replaceAll('-', '');
        const rotated = randomUUID().replaceAll('-', '');
        let userCreated = false;
        let caller: ConnectionResult | undefined;
        try {

            await bootstrapSchema(db, 'mysql');
            await sql`CREATE TABLE marker (value VARCHAR(20) NOT NULL)`.execute(db);
            await sql.raw(`CREATE USER '${user}'@'%' IDENTIFIED BY '${password}'`).execute(db);
            userCreated = true;
            await sql.raw(`GRANT ALL PRIVILEGES ON \`${connection.database}\`.* TO '${user}'@'%'`).execute(db);
            const userConfig = { ...connection, user, password, pool: { min: 0, max: 1 } };
            caller = await createConnection(userConfig, 'pipeline-account', { retries: 1, delay: 0 });
            await sql`SELECT 1`.execute(caller.db);
            await sql.raw(`ALTER USER '${user}'@'%' IDENTIFIED BY '${rotated}'`).execute(db);
            const folder = join(root, 'db', 'pipelines', 'refresh');
            await mkdir(folder, { recursive: true });
            await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({ transaction: 'none', singleRun: true,
                steps: [{ id: 'first', sql: 'a.sql' }] }));
            await writeFile(join(folder, 'a.sql'), "INSERT INTO marker VALUES ('A')");
            const context: PipelineContext = { db: caller.db as PipelineContext['db'], dialect: 'mysql',
                connectionConfig: userConfig, configName: 'alpha', identity: { name: 'test', source: 'config' },
                projectRoot: root, access: withPolicy({ user: 'admin', agent: 'admin' }), channel: 'user',
                pipelinesPath: './db/pipelines', cliVersion: 'test' };
            const failed = await runPipeline(context, 'refresh');
            if (failed.dryRun) throw new Error('expected execution');
            expect(failed.status).toBe('failed');
            expect(failed.transactionOutcome).toBe('no_effects');
            expect(failed.steps[0]).toMatchObject({ status: 'skipped', transactionOutcome: 'not_started',
                startedAt: null, finishedAt: null, durationMs: 0 });
            expect((await sql`SELECT * FROM marker`.execute(db)).rows).toEqual([]);
            const saved = await getPipelineRun({ db: context.db, dialect: 'mysql', configName: 'alpha', executedBy: 'test', cliVersion: 'test' }, failed.runId);
            expect(saved!.run).toMatchObject({ status: 'failed', transaction_outcome: 'no_effects', active_key: null });
            await sql.raw(`ALTER USER '${user}'@'%' IDENTIFIED BY '${password}'`).execute(db);
            const retry = await runPipeline(context, 'refresh');
            expect(retry.status).toBe('success');
            expect((await sql`SELECT * FROM marker`.execute(db)).rows).toEqual([{ value: 'A' }]);

        }
        finally {

            try {

                if (caller) await caller.destroy();

            }
            finally {

                try {

                    if (userCreated) await sql.raw(`DROP USER '${user}'@'%'`).execute(db);

                }
                finally {

                    await rm(root, { recursive: true, force: true });

                }

            }

        }

    });

}, 60_000);

it('retains manual MySQL failure intent when author-session cleanup fails', async () => {

    await withPipelineDatabase('mysql', async ({ db, connection }) => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-author-cleanup-'));
        try {

            await bootstrapSchema(db, 'mysql');
            await sql`CREATE TABLE marker (value VARCHAR(20) NOT NULL)`.execute(db);
            const folder = join(root, 'db', 'pipelines', 'refresh');
            await mkdir(folder, { recursive: true });
            await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({
                transaction: 'none', singleRun: true, steps: [
                    { id: 'begin', sql: 'begin.sql' },
                    { id: 'insert', sql: 'insert.sql' },
                    { id: 'failure', sql: 'failure.sql' },
                ],
            }));
            await writeFile(join(folder, 'begin.sql'), 'START TRANSACTION');
            await writeFile(join(folder, 'insert.sql'), "INSERT INTO marker VALUES ('A')");
            await writeFile(join(folder, 'failure.sql'), 'SELECT * FROM missing_pipeline_table');
            const plugin: KyselyPlugin = {
                transformQuery(args) {

                    if (args.node.kind === 'RawNode' && args.node.sqlFragments.join('').trim().toLowerCase() === 'rollback') {

                        throw new Error('author rollback failed before reaching server');

                    }

                    return args.node;

                },
                async transformResult(args) {

                    return args.result;

                },
            };
            const context: PipelineContext = { db: db.withPlugin(plugin), dialect: 'mysql',
                connectionConfig: connection, configName: 'alpha', identity: { name: 'test', source: 'config' },
                projectRoot: root, access: withPolicy({ user: 'admin', agent: 'admin' }), channel: 'user',
                pipelinesPath: './db/pipelines', cliVersion: 'test' };
            const result = await runPipeline(context, 'refresh');
            if (result.dryRun) throw new Error('expected execution');
            expect(result.status).toBe('unknown');
            expect(result.transactionOutcome).toBe('unknown');
            expect(result.primaryError).toMatchObject({ phase: 'execute', stepNo: 3 });
            expect(result.secondaryErrors).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'cleanup' })]));
            const saved = await getPipelineRun({
                db, dialect: 'mysql', configName: 'alpha', executedBy: 'test', cliVersion: 'test',
            }, result.runId);
            expect(saved!.run.status).toBe('pending');
            expect(saved!.run.active_key).not.toBeNull();
            await expect(runPipeline(context, 'refresh')).rejects.toBeInstanceOf(PipelineBusyError);

        }
        finally {

            await rm(root, { recursive: true, force: true });

        }

    });

}, 60_000);
