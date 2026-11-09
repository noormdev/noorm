import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { ConnectionConfig, Dialect } from '../../../src/core/connection/types.js';
import { runPipeline } from '../../../src/core/pipeline/executor.js';
import { PipelineEscapeError } from '../../../src/core/pipeline/sql-literal.js';
import type { PipelineContext, PipelineRunResult, PipelineTransaction } from '../../../src/core/pipeline/types.js';
import type { NoormDatabase } from '../../../src/core/shared/tables.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';
import { withPipelineDatabase } from '../../utils/pipeline-db.js';
import { withPolicy } from '../../utils/access.js';

const values = ["O'Brien\\backslash", 'Café 😀', '', "'); DROP TABLE literal_values; --\\b"];

async function withTableDatabase(
    dialect: Dialect,
    createTable: string,
    run: (db: Kysely<NoormDatabase>, connection: ConnectionConfig) => Promise<void>,
    options?: { pool?: ConnectionConfig['pool'] },
): Promise<void> {

    await withPipelineDatabase(dialect, async ({ db, connection }) => {

        await bootstrapSchema(db, dialect);
        await sql.raw(createTable).execute(db);
        await run(db, connection);

    }, options);

}

async function withPipelineFixture(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    connection: ConnectionConfig,
    pipeline: { files: Record<string, string>; transaction?: PipelineTransaction },
    run: (context: PipelineContext, folder: string) => Promise<void>,
): Promise<void> {

    const { files, transaction = 'step' } = pipeline;
    const root = await mkdtemp(join(tmpdir(), 'noorm-pipeline-literals-'));
    try {

        const folder = join(root, 'db', 'pipelines', 'refresh');
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({
            transaction,
            inputs: { label: { type: 'string', description: 'Value', required: true } },
            steps: Object.keys(files).map((file, index) => ({ id: `step${index + 1}`, sql: file })),
        }));
        for (const [name, content] of Object.entries(files)) await writeFile(join(folder, name), content);

        await run({
            db, dialect, connectionConfig: connection, configName: 'alpha', identity: { name: 'test', source: 'config' },
            projectRoot: root, access: withPolicy({ user: 'admin', agent: 'admin' }), channel: 'user', pipelinesPath: './db/pipelines', cliVersion: 'test',
        }, folder);

    }
    finally {

        await rm(root, { recursive: true, force: true });

    }

}

async function runRecorded(context: PipelineContext, label: string): Promise<PipelineRunResult> {

    const result = await runPipeline(context, 'refresh', { input: { label } });
    if (result.dryRun) throw new Error('unexpected dry run');

    return result;

}

async function expectMysqlEscapeRefused(db: Kysely<NoormDatabase>, context: PipelineContext, label: string, stepNo: number): Promise<void> {

    await expect(runPipeline(context, 'refresh', { input: { label } })).rejects.toThrow(escapeRefused(stepNo));
    expect(await storedValues(db, 'mysql_values')).toEqual([]);
    const runs = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM __noorm_pipeline_run__`.execute(db);
    expect(Number(runs.rows[0]?.n)).toBe(0);

}

async function storedValues(db: Kysely<NoormDatabase>, table: string): Promise<string[]> {

    return (await sql<{ value: string }>`SELECT value FROM ${sql.id(table)}`.execute(db)).rows.map((row) => row.value).sort();

}

const dialects: Dialect[] = ['sqlite', 'postgres', 'mysql', 'mssql'];

for (const dialect of dialects) {

    describe(`pipeline input literals: ${dialect}`, () => {

        it('round trips values in steps and includes as data', async () => {

            const textType = dialect === 'mssql' ? 'NVARCHAR(500)' : 'VARCHAR(500)';
            const createTable = `CREATE TABLE literal_values (direct_value ${textType} NOT NULL, included_value ${textType} NOT NULL)`;
            await withTableDatabase(dialect, createTable, async (db, connection) => {

                const files = {
                    'insert.sql.tmpl': "INSERT INTO literal_values (direct_value, included_value) VALUES ({%~ $.quote($.input.label) %}, {%~ await $.include('value.sql.tmpl') %})",
                };
                await withPipelineFixture(db, dialect, connection, { files }, async (context, folder) => {

                    await writeFile(join(folder, 'value.sql.tmpl'), '{%~ $.quote($.input.label) %}');
                    for (const label of values) {

                        expect((await runRecorded(context, label)).status).toBe('success');

                    }
                    const rows = (await sql<{
                        direct_value: string;
                        included_value: string;
                    }>`SELECT direct_value, included_value FROM literal_values`.execute(db)).rows;
                    expect(rows).toHaveLength(values.length);
                    expect(rows.map((row) => row.direct_value).sort()).toEqual([...values].sort());
                    expect(rows.map((row) => row.included_value).sort()).toEqual([...values].sort());

                });

            });

        }, 60_000);

    });

}

const MYSQL_BREAKOUT = "x\\'), (CURRENT_USER()) -- ";
const MYSQL_PAYLOADS = [MYSQL_BREAKOUT, 'plain\\back'];
const NO_BACKSLASH_ESCAPES = "SET SESSION sql_mode='NO_BACKSLASH_ESCAPES'";
const DEFAULT_MODE = "SET SESSION sql_mode=''";
const MYSQL_ESCAPE_INSERT = "INSERT INTO mysql_values (value) VALUES ('{%~ $.escape($.input.label) %}')";
const MYSQL_QUOTE_INSERT = 'INSERT INTO mysql_values (value) VALUES ({%~ $.quote($.input.label) %})';
const escapeRefused = (stepNo: number) => `Failed to prepare pipeline step ${stepNo}: ${new PipelineEscapeError().message}`;

describe('pipeline input literals: mysql session modes', () => {

    const MYSQL_TABLE = 'CREATE TABLE mysql_values (value VARCHAR(500) NOT NULL)';
    const rows: Array<{ name: string; files: (insert: string) => Record<string, string>; inserts: number; escapeStep: number }> = [
        { name: 'default mode', files: (insert) => ({ 'a.sql.tmpl': insert }), inserts: 1, escapeStep: 1 },
        { name: 'NO_BACKSLASH_ESCAPES set by a step', files: (insert) => ({ 'a.sql': NO_BACKSLASH_ESCAPES, 'b.sql.tmpl': insert }), inserts: 1, escapeStep: 2 },
        {
            name: 'mode switched back by a later step',
            files: (insert) => ({ 'a.sql': NO_BACKSLASH_ESCAPES, 'b.sql.tmpl': insert, 'c.sql': DEFAULT_MODE, 'd.sql.tmpl': insert }),
            inserts: 2,
            escapeStep: 2,
        },
    ];

    for (const row of rows) {

        it(`should refuse $.escape and run nothing: ${row.name}`, async () => {

            await withTableDatabase('mysql', MYSQL_TABLE, async (db, connection) => {

                await withPipelineFixture(db, 'mysql', connection, { files: row.files(MYSQL_ESCAPE_INSERT), transaction: 'pipeline' }, async (context) => {

                    await expectMysqlEscapeRefused(db, context, MYSQL_BREAKOUT, row.escapeStep);

                });

            });

        }, 60_000);

        it(`should store $.quote input exactly: ${row.name}`, async () => {

            await withTableDatabase('mysql', MYSQL_TABLE, async (db, connection) => {

                await withPipelineFixture(db, 'mysql', connection, { files: row.files(MYSQL_QUOTE_INSERT), transaction: 'pipeline' }, async (context) => {

                    for (const label of MYSQL_PAYLOADS) {

                        expect((await runRecorded(context, label)).status).toBe('success');

                    }
                    const expected = MYSQL_PAYLOADS.flatMap((label) => Array.from({ length: row.inserts }, () => label)).sort();
                    expect(await storedValues(db, 'mysql_values')).toEqual(expected);

                });

            });

        }, 60_000);

    }

    describe('context session is NO_BACKSLASH_ESCAPES', () => {

        async function withContextSession(run: (contextDb: Kysely<NoormDatabase>, connection: ConnectionConfig) => Promise<void>): Promise<void> {

            await withTableDatabase('mysql', MYSQL_TABLE, async (db, connection) => {

                await sql.raw(NO_BACKSLASH_ESCAPES).execute(db);
                await run(db, connection);

            }, { pool: { min: 0, max: 1 } });

        }

        it('should refuse $.escape and run nothing', async () => {

            await withContextSession(async (contextDb, connection) => {

                await withPipelineFixture(contextDb, 'mysql', connection, { files: { 'a.sql.tmpl': MYSQL_ESCAPE_INSERT }, transaction: 'pipeline' }, async (context) => {

                    await expectMysqlEscapeRefused(contextDb, context, MYSQL_BREAKOUT, 1);

                });

            });

        }, 60_000);

        it('should store $.quote input exactly', async () => {

            await withContextSession(async (contextDb, connection) => {

                await withPipelineFixture(contextDb, 'mysql', connection, { files: { 'a.sql.tmpl': MYSQL_QUOTE_INSERT }, transaction: 'pipeline' }, async (context) => {

                    for (const label of MYSQL_PAYLOADS) {

                        expect((await runRecorded(context, label)).status).toBe('success');

                    }
                    expect(await storedValues(contextDb, 'mysql_values')).toEqual([...MYSQL_PAYLOADS].sort());

                });

            });

        }, 60_000);

    });

});

describe('pipeline input literals: $.escape in a dry run', () => {

    it('should reject the same way as a real run', async () => {

        await withPipelineDatabase('sqlite', async ({ db, connection }) => {

            const files = { 'a.sql.tmpl': "SELECT '{%~ $.escape($.input.label) %}'" };
            await withPipelineFixture(db, 'sqlite', connection, { files }, async (context) => {

                const failure = runPipeline(context, 'refresh', { input: { label: 'x' }, dryRun: true });
                await expect(failure).rejects.toThrow(escapeRefused(1));

            });

        });

    }, 60_000);

});

describe('pipeline input literals: postgres', () => {

    const PG_TABLE = 'CREATE TABLE pg_values (value TEXT NOT NULL)';
    const PG_INSERT = 'INSERT INTO pg_values (value) VALUES ({%~ $.quote($.input.label) %})';
    const breakout = "x\\'), (current_user) -- ";

    it('should fail closed instead of injecting when a step turns standard_conforming_strings off', async () => {

        await withTableDatabase('postgres', PG_TABLE, async (db, connection) => {

            const files = { 'a.sql': 'SET standard_conforming_strings = off', 'b.sql.tmpl': PG_INSERT };
            await withPipelineFixture(db, 'postgres', connection, { files, transaction: 'pipeline' }, async (context) => {

                const result = await runRecorded(context, breakout);
                expect(result.status).toBe('failed');
                expect(result.steps[1]?.status).toBe('failed');
                expect(await storedValues(db, 'pg_values')).toEqual([]);

            });

        });

    }, 60_000);

    it('should store the breakout payload exactly when standard_conforming_strings is on', async () => {

        await withTableDatabase('postgres', PG_TABLE, async (db, connection) => {

            await withPipelineFixture(db, 'postgres', connection, { files: { 'a.sql.tmpl': PG_INSERT }, transaction: 'pipeline' }, async (context) => {

                expect((await runRecorded(context, breakout)).status).toBe('success');
                expect(await storedValues(db, 'pg_values')).toEqual([breakout]);

            });

        });

    }, 60_000);

    it('should keep input containing $$ inside a $$ body', async () => {

        await withTableDatabase('postgres', PG_TABLE, async (db, connection) => {

            const label = "a$$b'); DROP TABLE pg_values; --";
            const files = {
                'a.sql.tmpl': 'DO $$ BEGIN INSERT INTO pg_values (value) VALUES ({%~ $.quote($.input.label) %}); END $$',
            };
            await withPipelineFixture(db, 'postgres', connection, { files }, async (context) => {

                expect((await runRecorded(context, label)).status).toBe('success');
                expect(await storedValues(db, 'pg_values')).toEqual([label]);

            });

        });

    }, 60_000);

});

describe('pipeline input literals: mssql line breaks', () => {

    const labels = ['a\\\nb', 'a\\\r\nb', 'a\\\rb', 'ends with \\', 'two\\\\\nbackslashes'];

    it('should keep a backslash before a line break', async () => {

        await withTableDatabase('mssql', 'CREATE TABLE mssql_values (value NVARCHAR(500) NOT NULL)', async (db, connection) => {

            const files = { 'a.sql.tmpl': 'INSERT INTO mssql_values (value) VALUES ({%~ $.quote($.input.label) %})' };
            await withPipelineFixture(db, 'mssql', connection, { files }, async (context) => {

                for (const label of labels) {

                    expect((await runRecorded(context, label)).status).toBe('success');

                }
                expect(await storedValues(db, 'mssql_values')).toEqual([...labels].sort());

            });

        });

    }, 60_000);

});
