import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { Dialect } from '../../../src/core/connection/types.js';
import { runPipeline } from '../../../src/core/pipeline/executor.js';
import { getPipelineRun } from '../../../src/core/pipeline/history.js';
import type { PipelineContext } from '../../../src/core/pipeline/types.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';
import { withPipelineDatabase } from '../../utils/pipeline-db.js';
import { withPolicy } from '../../utils/access.js';

const labels = ['refresh', 'Refresh', 'refresh ', '刷新😀', '刷新😀 '];
const paths = ['first.sql', 'second.sql', 'third.sql', '数据.sql', '数据二.sql'];
const slug = '流程😀';
const executedBy = '操作员😀';

for (const dialect of ['sqlite', 'postgres', 'mysql', 'mssql'] as Dialect[]) {

    describe(`pipeline exact step identity: ${dialect}`, () => {

        it('executes distinct labels and preserves their metadata and dependencies', async () => {

            await withPipelineDatabase(dialect, async ({ db, connection }) => {

                // The fixture owns this disposable database; never change a configured database.
                if (dialect === 'mysql') {

                    await sql`ALTER DATABASE ${sql.id(connection.database!)} CHARACTER SET latin1 COLLATE latin1_swedish_ci`.execute(db);

                }
                await bootstrapSchema(db, dialect);
                await sql`CREATE TABLE identity_marker (marker INTEGER NOT NULL)`.execute(db);
                const root = await mkdtemp(join(tmpdir(), 'noorm-step-identity-'));
                try {

                    const folder = join(root, 'db', 'pipelines', slug);
                    await mkdir(folder, { recursive: true });
                    const needs = [[], [labels[0]!], [labels[1]!], [labels[2]!], [labels[3]!]];
                    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({
                        transaction: 'step',
                        steps: labels.map((id, index) => ({ id, sql: paths[index], needs: needs[index] })),
                    }));
                    for (let index = 0; index < labels.length; index++) {

                        const statement = index === 0
                            ? 'INSERT INTO identity_marker (marker) VALUES (1)'
                            : `INSERT INTO identity_marker (marker) SELECT ${index + 1}
                                WHERE EXISTS (SELECT 1 FROM identity_marker WHERE marker = ${index})`;
                        await writeFile(join(folder, paths[index]!), statement);

                    }
                    const context: PipelineContext = {
                        db, dialect, connectionConfig: connection, configName: 'identity-test',
                        identity: { name: executedBy, source: 'config' }, projectRoot: root,
                        access: withPolicy({ user: 'admin', agent: 'admin' }), channel: 'user',
                        pipelinesPath: './db/pipelines', cliVersion: 'test',
                    };
                    const result = await runPipeline(context, slug);
                    if (result.dryRun) throw new Error('unexpected dry run');
                    expect(result.status).toBe('success');
                    expect(result.transactionOutcome).toBe('committed');
                    expect(result.steps.map((step) => ({
                        name: step.name, filepath: step.filepath, needs: step.needs,
                        status: step.status, outcome: step.transactionOutcome,
                    })))
                        .toEqual(labels.map((name, index) => ({ name, filepath: paths[index]!, needs: index ? [index] : [], status: 'success', outcome: 'committed' })));
                    const markers = (await sql<{ marker: number }>`SELECT marker FROM identity_marker ORDER BY marker`.execute(db)).rows;
                    expect(markers.map((row) => row.marker)).toEqual([1, 2, 3, 4, 5]);

                    const record = await getPipelineRun({ db, dialect, configName: context.configName, executedBy, cliVersion: 'test' }, result.runId);
                    expect(record).not.toBeNull();
                    expect(record!.run.slug).toBe(slug);
                    expect(record!.run.executed_by).toBe(executedBy);
                    expect(record!.run.status).toBe('success');
                    expect(record!.run.transaction_outcome).toBe('committed');
                    expect(record!.steps.map((step) => ({
                        number: step.step_no, name: step.name, filepath: step.filepath, needs: JSON.parse(step.needs),
                        status: step.status, outcome: step.transaction_outcome,
                    })))
                        .toEqual(labels.map((name, index) => ({ number: index + 1, name, filepath: paths[index]!, needs: index ? [index] : [], status: 'success', outcome: 'committed' })));
                    for (const step of record!.steps) expect(Object.hasOwn(step, 'name_key')).toBe(false);

                }
                finally {

                    await rm(root, { recursive: true, force: true });

                }

            }, { sqliteFile: true });

        }, 60_000);

    });

}
