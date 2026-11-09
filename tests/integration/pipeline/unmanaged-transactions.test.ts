import { expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { runPipeline } from '../../../src/core/pipeline/executor.js';
import { getPipelineRun } from '../../../src/core/pipeline/history.js';
import type { PipelineContext } from '../../../src/core/pipeline/types.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';
import { withPipelineDatabase } from '../../utils/pipeline-db.js';
import { withPolicy } from '../../utils/access.js';

for (const sqliteFile of [true, false]) {

    it(`reports manual SQLite transaction provenance honestly (${sqliteFile ? 'file' : 'memory'})`, async () => {

        await withPipelineDatabase('sqlite', async ({ db, connection }) => {

            const root = await mkdtemp(join(tmpdir(), 'noorm-unmanaged-'));
            try {

                await bootstrapSchema(db, 'sqlite');
                await sql`CREATE TABLE marker (value TEXT NOT NULL)`.execute(db);
                const folder = join(root, 'db', 'pipelines', 'refresh');
                await mkdir(folder, { recursive: true });
                const context: PipelineContext = { db, dialect: 'sqlite', connectionConfig: connection,
                    configName: 'alpha', identity: { name: 'test', source: 'config' }, projectRoot: root,
                    access: withPolicy({ user: 'admin', agent: 'admin' }), channel: 'user', pipelinesPath: './db/pipelines', cliVersion: 'test' };
                const run = async (bodies: string[]) => {

                    await Promise.all(bodies.map((body, i) => writeFile(join(folder, `${i}.sql`), body)));
                    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({ transaction: 'none', singleRun: true,
                        steps: bodies.map((_, i) => ({ id: `step${i}`, sql: `${i}.sql` })) }));
                    const result = await runPipeline(context, 'refresh');
                    if (result.dryRun) throw new Error('expected execution');
                    const saved = await getPipelineRun({ db, dialect: 'sqlite', configName: 'alpha', executedBy: 'test', cliVersion: 'test' }, result.runId);
                    expect(saved!.run.active_key).toBeNull();
                    expect(saved!.run.transaction_outcome).toBe(result.transactionOutcome);

                    return result;

                };
                const markers = async () => (await sql<{ value: string }>`
                    SELECT value FROM marker ORDER BY value
                `.execute(db)).rows.map((row) => row.value);
                const failed = await run(["BEGIN; INSERT INTO marker VALUES ('A')", 'SELECT * FROM missing_table']);
                expect(failed.status).toBe('unknown');
                expect(failed.transactionOutcome).toBe('unknown');
                expect(failed.steps[0]).toMatchObject({ status: 'success', transactionOutcome: 'unknown' });
                expect(await markers()).toEqual([]);
                const success = await run(["BEGIN; INSERT INTO marker VALUES ('B'); COMMIT"]);
                expect(success.status).toBe('success');
                expect(success.transactionOutcome).toBe('unknown');
                expect(await markers()).toEqual(['B']);
                const mixedSuccess = await run(["INSERT INTO marker VALUES ('E')", "BEGIN; INSERT INTO marker VALUES ('F'); COMMIT"]);
                expect(mixedSuccess.status).toBe('success');
                expect(mixedSuccess.transactionOutcome).toBe('unknown');
                expect(mixedSuccess.steps.map((step) => step.transactionOutcome)).toEqual(['committed', 'unknown']);
                const partial = await run(["INSERT INTO marker VALUES ('C')", "BEGIN; INSERT INTO marker VALUES ('D'); SELECT * FROM missing_table"]);
                expect(partial.status).toBe('partial');
                expect(partial.steps[0]!.transactionOutcome).toBe('committed');
                expect(await markers()).toEqual(['B', 'C', 'E', 'F']);
                const plain = await run(["INSERT INTO marker VALUES ('COMMIT') /* BEGIN; ROLLBACK */"]);
                expect(plain.status).toBe('success');
                expect(plain.transactionOutcome).toBe('committed');
                expect(await markers()).toEqual(['B', 'C', 'COMMIT', 'E', 'F']);

            }
            finally {

                await rm(root, { recursive: true, force: true });

            }

        }, { sqliteFile });

    }, 60_000);

}

for (const dialect of ['postgres', 'mysql', 'mssql', 'sqlite'] as const) {

    it(`settles manual ${dialect} transactions before audit and graph lease reuse`, async () => {

        await withPipelineDatabase(dialect, async ({ db, connection }) => {

            const root = await mkdtemp(join(tmpdir(), 'noorm-author-settlement-'));
            try {

                await bootstrapSchema(db, dialect);
                await sql`CREATE TABLE marker (value VARCHAR(20) NOT NULL)`.execute(db);
                const folder = join(root, 'db', 'pipelines', 'refresh');
                await mkdir(folder, { recursive: true });
                const context: PipelineContext = { db, dialect, connectionConfig: connection,
                    configName: 'alpha', identity: { name: 'test', source: 'config' }, projectRoot: root,
                    access: withPolicy({ user: 'admin', agent: 'admin' }), channel: 'user',
                    pipelinesPath: './db/pipelines', cliVersion: 'test', poolMax: 1 };
                const run = async (bodies: string[], graph = false) => {

                    await Promise.all(bodies.map((body, i) => writeFile(join(folder, `${i}.sql`), body)));
                    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({
                        transaction: 'none', singleRun: true, concurrency: 1,
                        steps: bodies.map((_, i) => ({ id: `step${i}`, sql: `${i}.sql`,
                            ...(graph ? { needs: i ? [`step${i - 1}`] : [] } : {}) })),
                    }));
                    const result = await runPipeline(context, 'refresh');
                    if (result.dryRun) throw new Error('expected execution');
                    const saved = await getPipelineRun({
                        db, dialect, configName: 'alpha', executedBy: 'test', cliVersion: 'test',
                    }, result.runId);
                    expect(saved!.run.active_key).toBeNull();
                    expect(saved!.run.transaction_outcome).toBe(result.transactionOutcome);

                    return result;

                };
                const markers = async () => (await sql<{ value: string }>`
                    SELECT value FROM marker ORDER BY value
                `.execute(db)).rows.map((row) => row.value);
                const successBodies = dialect === 'mysql'
                    ? ['START TRANSACTION', "INSERT INTO marker VALUES ('committed')", 'COMMIT']
                    : dialect === 'mssql'
                        ? ["BEGIN TRANSACTION; INSERT INTO marker VALUES ('committed'); COMMIT TRANSACTION"]
                        : ['BEGIN', "INSERT INTO marker VALUES ('committed')", 'COMMIT'];
                const success = await run(successBodies);
                expect(success.status).toBe('success');
                expect(success.transactionOutcome).toBe('unknown');
                expect(await markers()).toEqual(['committed']);
                const failureBodies = dialect === 'mysql'
                    ? ['START TRANSACTION', "INSERT INTO marker VALUES ('rolledback')", 'SELECT * FROM missing_table']
                    : dialect === 'mssql'
                        ? ["BEGIN TRANSACTION; INSERT INTO marker VALUES ('rolledback'); SELECT * FROM missing_table"]
                        : ["BEGIN; INSERT INTO marker VALUES ('rolledback')", 'SELECT * FROM missing_table'];
                const failure = await run(failureBodies);
                expect(failure.status).toBe('unknown');
                expect(failure.transactionOutcome).toBe('unknown');
                expect(failure.primaryError?.phase).toBe('execute');
                expect(await markers()).toEqual(['committed']);
                const graphBodies = dialect === 'mysql'
                    ? ['SET autocommit = 0', "INSERT INTO marker VALUES ('graph')"]
                    : dialect === 'mssql'
                        ? ["BEGIN TRANSACTION; INSERT INTO marker VALUES ('graphmanual'); COMMIT TRANSACTION",
                            "INSERT INTO marker VALUES ('graph')"]
                        : ["BEGIN; INSERT INTO marker VALUES ('discarded')", "INSERT INTO marker VALUES ('graph')"];
                const graph = await run(graphBodies, true);
                expect(graph.status).toBe('success');
                expect(graph.steps[0]!.transactionOutcome).toBe('unknown');
                expect(graph.steps[1]!.transactionOutcome).toBe('committed');
                expect(await markers()).toEqual(dialect === 'mssql'
                    ? ['committed', 'graph', 'graphmanual'] : ['committed', 'graph']);

            }
            finally {

                await rm(root, { recursive: true, force: true });

            }

        }, { sqliteFile: true });

    }, 60_000);

}
