import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { runPipeline } from '../../../src/core/pipeline/executor.js';
import { getPipelineRun } from '../../../src/core/pipeline/history.js';
import type { PipelineContext } from '../../../src/core/pipeline/types.js';
import type { NoormDatabase } from '../../../src/core/shared/tables.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';
import { withPolicy } from '../../utils/access.js';

let root: string;
let folder: string;
let db: Kysely<NoormDatabase>;
let context: PipelineContext;
let fault: 'commit' | 'rollback' | 'rollback-unsettled' | null;
let workflowStarted: boolean;
let abortAfterMarker: AbortController | null;
let queueRootQuery: boolean;
let queuedRootQuery: Promise<unknown> | null;
let failStatement: ((statement: string) => boolean) | null;
let disposedMemory: number;

async function rows(table: string) {

    return (await sql<Record<string, unknown>>`select * from ${sql.table(table)}`.execute(db)).rows;

}

async function manifest(transaction: 'pipeline' | 'step' | 'none', bodies: string[], options: Record<string, unknown> = {}) {

    const steps = bodies.map((_, index) => ({ id: `step${index + 1}`, sql: `${index + 1}.sql` }));
    await Promise.all(bodies.map((body, index) => writeFile(join(folder, `${index + 1}.sql`), body)));
    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({ transaction, steps, ...options }));

}

const failureSteps = [
    "insert into marker values ('A')",
    "insert into marker values ('B'); insert into nonexistent_table values ('failure')",
    "insert into marker values ('C')",
];

beforeEach(async () => {

    root = await mkdtemp(join(tmpdir(), 'noorm-pipeline-boundary-'));
    folder = join(root, 'db', 'pipelines', 'refresh');
    await mkdir(folder, { recursive: true });
    fault = null;
    workflowStarted = false;
    abortAfterMarker = null;
    queueRootQuery = false;
    queuedRootQuery = null;
    failStatement = null;
    disposedMemory = 0;
    const sqlite = new BunSqliteDatabase(':memory:');
    const adapter = {
        close: () => sqlite.close(),
        prepare(statement: string) {

            const prepared = sqlite.prepare(statement);
            const intercept = () => {

                if (/insert into marker/i.test(statement)) workflowStarted = true;
                const current = statement.trim().toLowerCase();
                if (failStatement?.(current)) throw new Error('injected statement failure');
                if (workflowStarted && fault && (current === fault || (fault === 'rollback-unsettled' && current === 'rollback'))) {

                    const selected = fault;
                    fault = null;
                    if (selected !== 'rollback-unsettled') prepared.run([]);
                    throw new Error(`injected ${selected} acknowledgement failure`);

                }

            };

            return {
                get reader() {

                    return prepared.reader;

                },
                all(params: ReadonlyArray<unknown>) {

                    intercept();

                    return prepared.all(params);

                },
                run(params: ReadonlyArray<unknown>) {

                    intercept();

                    const result = prepared.run(params);
                    if (/insert into marker/i.test(statement) && queueRootQuery) {

                        queueRootQuery = false;
                        queuedRootQuery = sql`select * from marker`.execute(db);
                        void queuedRootQuery.catch(() => undefined);

                    }
                    if (/insert into marker/i.test(statement) && abortAfterMarker) {

                        abortAfterMarker.abort();
                        abortAfterMarker = null;

                    }

                    return result;

                },
                iterate(params: ReadonlyArray<unknown>) {

                    intercept();

                    return prepared.iterate(params);

                },
            };

        },
    };
    db = new Kysely<NoormDatabase>({ dialect: new SqliteDialect({ database: adapter }) });
    await bootstrapSchema(db, 'sqlite');
    await sql`create table marker (value text not null)`.execute(db);
    context = {
        db, dialect: 'sqlite', connectionConfig: { dialect: 'sqlite', database: ':memory:' },
        configName: 'alpha', identity: { name: 'Test', source: 'config' },
        projectRoot: root, access: withPolicy({ user: 'admin', agent: 'admin' }), channel: 'user',
        pipelinesPath: './db/pipelines', cliVersion: 'test',
    };

});

afterEach(async () => {

    await db.destroy();
    await rm(root, { recursive: true, force: true });

});

const historyContext = () => ({ db, dialect: 'sqlite' as const, configName: 'alpha', executedBy: 'Test', cliVersion: 'test' });

async function history(id: number) {

    const record = await getPipelineRun(historyContext(), id);
    expect(record).not.toBeNull();

    return record!;

}

describe('pipeline: boundary execution', () => {

    for (const [transaction, expectedMarkers, expectedOutcome, firstOutcome, failedOutcome] of [
        ['pipeline', [], 'rolled_back', 'rolled_back', 'rolled_back'],
        ['step', ['A'], 'partial', 'committed', 'rolled_back'],
        ['none', ['A', 'B'], 'unknown', 'committed', 'unknown'],
    ] as const) {

        it(`should preserve the correct markers and durable complete audit after failure under ${transaction}`, async () => {

            await manifest(transaction, failureSteps);
            const result = await runPipeline(context, 'refresh');
            if (result.dryRun) throw new Error('expected admitted execution');
            expect(result.status).not.toBe('success');
            if (transaction === 'none') expect(['unknown', 'partial']).toContain(result.transactionOutcome);
            else expect(result.transactionOutcome).toBe(expectedOutcome);
            const actualMarkers: readonly unknown[] = (await rows('marker')).map((row) => row['value']);
            expect(actualMarkers).toEqual(expectedMarkers);
            expect(result.steps.map((step) => step.name)).toEqual(['step1', 'step2', 'step3']);
            expect(result.steps[0]).toMatchObject({ status: 'success', transactionOutcome: firstOutcome });
            expect(result.steps[1]).toMatchObject({ status: 'failed', transactionOutcome: failedOutcome });
            expect(result.steps[2]).toMatchObject({ status: 'skipped', transactionOutcome: 'not_started', startedAt: null, finishedAt: null, durationMs: 0 });
            expect(result.primaryError).toMatchObject({ phase: 'execute', stepNo: 2 });
            const saved = await history(result.runId);
            expect(saved.run.status).toBe(result.status);
            expect(saved.run.transaction_outcome).toBe(result.transactionOutcome);
            expect(saved.steps.map((step) => step.status)).toEqual(['success', 'failed', 'skipped']);
            expect(saved.steps.map((step) => step.transaction_outcome)).toEqual([firstOutcome, failedOutcome, 'not_started']);
            expect(await rows('__noorm_change__')).toEqual([]);
            expect(await rows('__noorm_executions__')).toEqual([]);

        }, 10000);

    }

    it('should use a pinned session for temporary state in pipeline and linear unmanaged execution', async () => {

        for (const transaction of ['pipeline', 'none'] as const) {

            await manifest(transaction, [
                'create temp table session_marker (value text); insert into session_marker values (\'pinned\')',
                'insert into marker select value from session_marker; drop table session_marker',
            ]);
            const result = await runPipeline(context, 'refresh');
            if (result.dryRun) throw new Error('expected admitted execution');
            expect(result.status).toBe('success');
            expect((await history(result.runId)).run.status).toBe('success');

        }
        expect((await rows('marker')).map((row) => row['value'])).toEqual(['pinned', 'pinned']);

    }, 10000);

    it('should execute identical repeated declarations and new invocations without checksum gating', async () => {

        await manifest('step', ["insert into marker values ('repeat')"]);
        await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({ transaction: 'step', steps: [
            { id: 'first', sql: '1.sql' }, { id: 'again', sql: '1.sql' },
        ] }));
        const first = await runPipeline(context, 'refresh');
        const second = await runPipeline(context, 'refresh');
        if (first.dryRun || second.dryRun) throw new Error('expected admitted executions');
        expect(first.status).toBe('success');
        expect(second.status).toBe('success');
        expect(second.runId).toBeGreaterThan(first.runId);
        expect(await rows('marker')).toHaveLength(4);
        expect((await history(first.runId)).steps).toHaveLength(2);
        expect((await history(second.runId)).steps).toHaveLength(2);

    }, 10000);
    it('should execute graph steps in dynamically eligible declaration order', async () => {

        for (const transaction of ['pipeline', 'step', 'none'] as const) {

            await manifest(transaction, [
                "insert into marker values ('child')",
                "insert into marker values ('root')",
                "insert into marker values ('independent')",
            ], { concurrency: 8, steps: [
                { id: 'child', sql: '1.sql', needs: ['root'] },
                { id: 'root', sql: '2.sql', needs: [] },
                { id: 'independent', sql: '3.sql', needs: [] },
            ] });
            const result = await runPipeline(context, 'refresh');
            if (result.dryRun) throw new Error('expected admitted execution');
            expect(result.status).toBe('success');
            expect(result.concurrency).toBe(1);
            expect((await rows('marker')).map((row) => row['value']).slice(-3))
                .toEqual(['root', 'child', 'independent']);
            expect((await history(result.runId)).steps.map((step) => step.status))
                .toEqual(['success', 'success', 'success']);

        }

    }, 10000);


    it('should preflight all rendered steps and permit dry run without writing history or executing SQL', async () => {

        await manifest('pipeline', ["insert into marker values ('A')", 'select 1; rollback']);
        await expect(runPipeline(context, 'refresh')).rejects.toThrow();
        expect(await rows('marker')).toEqual([]);
        expect(await rows('__noorm_pipeline_run__')).toEqual([]);
        await manifest('pipeline', ["insert into marker values ('A')"]);
        const result = await runPipeline(context, 'refresh', { dryRun: true });
        expect(result.dryRun).toBe(true);
        expect(result.runId).toBeNull();
        expect(await rows('marker')).toEqual([]);
        expect(await rows('__noorm_pipeline_run__')).toEqual([]);

    });

    it('should enforce policy for normal and dry runs before admission', async () => {

        await manifest('step', ["insert into marker values ('A')"]);
        for (const dryRun of [false, true]) {

            for (const denied of [
                { access: withPolicy({ user: 'viewer', agent: 'viewer' }), channel: 'user' as const },
                { access: withPolicy({ user: 'operator', agent: 'operator' }), channel: 'user' as const },
                { access: withPolicy({ user: 'operator', agent: 'operator' }), channel: 'agent' as const, yes: true },
            ]) await expect(runPipeline({ ...context, ...denied }, 'refresh', { dryRun })).rejects.toThrow();

        }
        expect(await rows('marker')).toEqual([]);
        expect(await rows('__noorm_pipeline_run__')).toEqual([]);

    });

    it('should not expose input or rendered SQL in result and history even on SQL failure', async () => {

        const secret = 'secret-private-value-7429';
        await manifest('step', ["insert into missing_table values ('{%~ $.input.value %}')"], {
            inputs: { value: { type: 'string', description: 'Value', required: true } },
            steps: [{ id: 'secret', sql: '1.sql.tmpl' }],
        });
        await writeFile(join(folder, '1.sql.tmpl'), "insert into missing_table values ('{%~ $.input.value %}')");
        const result = await runPipeline(context, 'refresh', { input: { value: secret } });
        if (result.dryRun) throw new Error('expected admitted execution');
        expect(result.status).not.toBe('success');
        const output = JSON.stringify([result, await history(result.runId)]);
        expect(output).not.toContain(secret);
        expect(output).not.toContain('insert into missing_table');
        expect(output).not.toContain(root);

    });

    it('should mark pre-aborted unstarted steps without executing workflow SQL', async () => {

        await manifest('step', failureSteps);
        const controller = new AbortController();
        controller.abort();
        const result = await runPipeline(context, 'refresh', { signal: controller.signal });
        if (result.dryRun) throw new Error('expected admitted execution');
        expect(result.status).toBe('interrupted');
        expect(result.steps).toHaveLength(3);
        for (const step of result.steps) expect(step).toMatchObject({ status: 'skipped', transactionOutcome: 'not_started', startedAt: null, finishedAt: null, durationMs: 0 });
        expect(await rows('marker')).toEqual([]);
        expect((await history(result.runId)).steps.map((step) => step.status)).toEqual(['skipped', 'skipped', 'skipped']);

    });

    it('should preserve interruption as primary when rollback acknowledgement is lost', async () => {

        await manifest('pipeline', ["insert into marker values ('A')", "insert into marker values ('B')"], { singleRun: true });
        const controller = new AbortController();
        abortAfterMarker = controller;
        fault = 'rollback';
        const result = await runPipeline(context, 'refresh', { signal: controller.signal });
        if (result.dryRun) throw new Error('expected admitted execution');
        expect(result.status).toBe('interrupted');
        expect(result.primaryError).toMatchObject({ phase: 'interrupted' });
        expect(result.secondaryErrors).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'rollback' })]));
        expect(result.transactionOutcome).toBe('unknown');
        expect(result.steps.map((step) => [step.status, step.transactionOutcome]))
            .toEqual([['success', 'unknown'], ['skipped', 'not_started']]);
        expect(await rows('marker')).toEqual([]);
        const saved = await history(result.runId);
        expect(saved.run.status).toBe('interrupted');
        expect(saved.run.transaction_outcome).toBe('unknown');
        expect(saved.run.active_key).toBeNull();

    }, 10000);

    it('should preserve execution as primary when rollback acknowledgement fails', async () => {

        await manifest('pipeline', failureSteps, { singleRun: true });
        fault = 'rollback';
        const result = await runPipeline(context, 'refresh');
        if (result.dryRun) throw new Error('expected admitted execution');
        expect(result.primaryError).toMatchObject({ phase: 'execute', stepNo: 2 });
        expect(result.secondaryErrors).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'rollback' })]));
        expect(result.transactionOutcome).toBe('unknown');
        expect(await rows('marker')).toEqual([]);
        expect((await history(result.runId)).run.transaction_outcome).toBe('unknown');

    }, 10000);

    it('should retain protection when rollback fails before the transaction settles', async () => {

        await manifest('pipeline', failureSteps, { singleRun: true });
        queueRootQuery = true;
        fault = 'rollback-unsettled';
        const result = await runPipeline(context, 'refresh');
        if (result.dryRun) throw new Error('expected admitted execution');
        expect(result.primaryError).toMatchObject({ phase: 'execute', stepNo: 2 });
        expect(result.secondaryErrors).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'rollback' })]));
        expect(result.transactionOutcome).toBe('unknown');
        expect(queuedRootQuery).not.toBeNull();
        await expect(queuedRootQuery!).rejects.toThrow();
        await expect(rows('marker')).rejects.toThrow();

    }, 10000);

    it('should report an unknown commit acknowledgement rather than claiming rollback or success', async () => {

        await manifest('pipeline', ["insert into marker values ('A')"], { singleRun: true });
        fault = 'commit';
        const result = await runPipeline(context, 'refresh');
        if (result.dryRun) throw new Error('expected admitted execution');
        expect(result.status).not.toBe('success');
        expect(result.transactionOutcome).toBe('unknown');
        expect(result.primaryError).toMatchObject({ phase: 'commit' });
        expect(result.secondaryErrors).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'rollback' })]));
        expect((await rows('marker')).map((row) => row['value'])).toEqual(['A']);
        const saved = await history(result.runId);
        expect(saved.run.transaction_outcome).toBe('unknown');
        expect(saved.run.active_key).toBeNull();

    }, 10000);

    it('should not report success when final bookkeeping fails, and should release settled protection', async () => {

        await manifest('pipeline', ["insert into marker values ('A')"], { singleRun: true });
        await sql`create trigger fail_audit before update of status on __noorm_pipeline_run__
            begin select raise(abort, 'audit fault'); end`.execute(db);
        const result = await runPipeline(context, 'refresh');
        if (result.dryRun) throw new Error('expected admitted execution');
        expect(result.status).not.toBe('success');
        expect(result.transactionOutcome).toBe('committed');
        expect(result.primaryError).toMatchObject({ phase: 'audit' });
        expect((await rows('marker')).map((row) => row['value'])).toEqual(['A']);
        expect((await history(result.runId)).run.active_key).toBeNull();

    }, 10000);

    describe('boundary setup failure on in-memory SQLite', () => {

        const runCounting = () => runPipeline({
            ...context, disposeMemoryConnection: async () => {

                disposedMemory++;

            },
        }, 'refresh');

        it('should dispose the memory connection and keep protection when BEGIN fails', async () => {

            await manifest('pipeline', ["insert into marker values ('A')"], { singleRun: true });
            let begins = 0;
            // Admission issues the first BEGIN on the shared in-memory connection.
            failStatement = (statement) => statement === 'begin' && ++begins === 2;
            const result = await runCounting();
            if (result.dryRun) throw new Error('expected admitted execution');
            expect(result.status).not.toBe('success');
            expect(result.primaryError).toMatchObject({ phase: 'execute' });
            expect(result.primaryError?.stepNo).toBeUndefined();
            expect(result.steps.map((step) => [step.status, step.transactionOutcome])).toEqual([['skipped', 'not_started']]);
            expect(disposedMemory).toBe(1);
            expect(await rows('marker')).toEqual([]);
            const saved = await history(result.runId);
            expect(saved.run.status).toBe('pending');
            expect(saved.run.active_key).not.toBeNull();

        }, 10000);

        it('should dispose the memory connection when the ownership SAVEPOINT and its rollback both fail', async () => {

            await manifest('pipeline', ["insert into marker values ('A')"], { singleRun: true });
            failStatement = (statement) => statement.startsWith('savepoint') || statement === 'rollback';
            const result = await runCounting();
            if (result.dryRun) throw new Error('expected admitted execution');
            expect(result.primaryError).toMatchObject({ phase: 'execute' });
            expect(disposedMemory).toBe(1);
            expect((await history(result.runId)).run.active_key).not.toBeNull();

        }, 10000);

        it('should release protection without disposing when the SAVEPOINT fails but rollback succeeds', async () => {

            await manifest('pipeline', ["insert into marker values ('A')"], { singleRun: true });
            failStatement = (statement) => statement.startsWith('savepoint');
            const result = await runCounting();
            if (result.dryRun) throw new Error('expected admitted execution');
            expect(result.primaryError).toMatchObject({ phase: 'execute' });
            expect(disposedMemory).toBe(0);
            expect(await rows('marker')).toEqual([]);
            expect((await history(result.runId)).run.active_key).toBeNull();

        }, 10000);

    });

});
