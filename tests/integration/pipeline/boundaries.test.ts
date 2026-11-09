import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type KyselyPlugin } from 'kysely';
import type { ConnectionConfig, Dialect } from '../../../src/core/connection/types.js';
import { runPipeline } from '../../../src/core/pipeline/executor.js';
import { getPipelineRun } from '../../../src/core/pipeline/history.js';
import type { PipelineContext } from '../../../src/core/pipeline/types.js';
import { getNoormTables, type PipelineStepStatus, type PipelineTransactionOutcome } from '../../../src/core/shared/tables.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';
import { withPipelineDatabase } from '../../utils/pipeline-db.js';

const dialects: Dialect[] = ['sqlite', 'postgres', 'mysql', 'mssql'];
type Policy = 'pipeline' | 'step' | 'none';
const markerA = "INSERT INTO marker VALUES ('A')";
const markerC = "INSERT INTO marker VALUES ('C')";

async function withProject<T>(body: (folder: string, root: string) => Promise<T>): Promise<T> {

    const root = await mkdtemp(join(tmpdir(), 'noorm-boundaries-'));
    try {

        const folder = join(root, 'db', 'pipelines', 'refresh');
        await mkdir(folder, { recursive: true });

        return await body(folder, root);

    }
    finally {

        await rm(root, { recursive: true, force: true });

    }

}

async function manifest(folder: string, transaction: Policy, bodies: string[]) {

    await Promise.all(bodies.map((body, i) => writeFile(join(folder, `${i}.sql`), body)));
    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({
        transaction, singleRun: true, steps: bodies.map((_, i) => ({ id: `step${i + 1}`, sql: `${i}.sql` })),
    }));

}

function historyContext(context: PipelineContext) {

    return { db: context.db, dialect: context.dialect, configName: context.configName, executedBy: 'test', cliVersion: 'test' };

}

function contextFor(db: PipelineContext['db'], dialect: Dialect, root: string, connectionConfig: ConnectionConfig): PipelineContext {

    return { db, dialect, connectionConfig, configName: 'alpha', identity: { name: 'test', source: 'config' }, projectRoot: root,
        access: { user: 'admin', agent: 'admin' }, channel: 'user', pipelinesPath: './db/pipelines', cliVersion: 'test' };

}

function runTable(dialect: Dialect) {

    const name = getNoormTables(dialect).pipelineRun;

    return sql.table(dialect === 'postgres' || dialect === 'mssql' ? `noorm.${name}` : name);

}

for (const dialect of dialects) {

    describe(`pipeline SQL boundaries: ${dialect}`, () => {

        for (const policy of ['pipeline', 'step', 'none'] as const) {

            it(`${policy} persists ordered audit and actual transactional effects`, async () => {

                await withPipelineDatabase(dialect, async ({ db, connection }) => withProject(async (folder, root) => {

                    if (dialect === 'sqlite') await sql`PRAGMA busy_timeout = 1000`.execute(db);
                    await bootstrapSchema(db, dialect);
                    await sql`CREATE TABLE marker (value VARCHAR(20) NOT NULL)`.execute(db);
                    if (dialect === 'mysql') {

                        await sql.raw("CREATE PROCEDURE fail_marker() BEGIN INSERT INTO marker VALUES ('B'); SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'failure'; END").execute(db);

                    }
                    const failed = dialect === 'mysql' ? 'CALL fail_marker()'
                        : dialect === 'mssql' ? "INSERT INTO marker VALUES ('B')\nGO\nSELECT * FROM missing_pipeline_table"
                            : "INSERT INTO marker VALUES ('B'); SELECT * FROM missing_pipeline_table";
                    await manifest(folder, policy, [markerA, failed, markerC]);
                    const context = contextFor(db, dialect, root, connection);
                    const result = await runPipeline(context, 'refresh');
                    if (result.dryRun) throw new Error('expected admitted execution');
                    const expected = policy === 'pipeline' ? [] : policy === 'step' || dialect === 'postgres' ? ['A'] : ['A', 'B'];
                    const markers = await sql<{ value: string }>`SELECT value FROM marker ORDER BY value`.execute(db);
                    expect(markers.rows.map((row) => row.value)).toEqual(expected);
                    const first = policy === 'pipeline' ? 'rolled_back' : 'committed';
                    const failedOutcome = policy === 'none' ? 'unknown' : 'rolled_back';
                    expect(result.transactionOutcome).toBe(policy === 'pipeline' ? 'rolled_back' : 'partial');
                    expect(result.primaryError).toMatchObject({ phase: 'execute', stepNo: 2 });
                    expect(result.steps.map((step) => [step.name, step.status, step.transactionOutcome])).toEqual([
                        ['step1', 'success', first], ['step2', 'failed', failedOutcome], ['step3', 'skipped', 'not_started'],
                    ]);
                    expect(result.steps[2]).toMatchObject({ startedAt: null, finishedAt: null, durationMs: 0 });
                    const saved = await getPipelineRun(historyContext(context), result.runId);
                    expect(saved).not.toBeNull();
                    expect(saved!.run.status).toBe(result.status);
                    expect(saved!.run.transaction_outcome).toBe(result.transactionOutcome);
                    expect(saved!.run.active_key).toBeNull();
                    expect(saved!.steps.map((step) => step.step_no)).toEqual([1, 2, 3]);
                    expect(saved!.steps.map((step) => [step.name, step.status, step.transaction_outcome])).toEqual([
                        ['step1', 'success', first], ['step2', 'failed', failedOutcome], ['step3', 'skipped', 'not_started'],
                    ]);

                }), { sqliteFile: true });

            }, 60_000);

        }

        it('pins session-local state for pipeline and linear none', async () => {

            await withPipelineDatabase(dialect, async ({ db, connection }) => withProject(async (folder, root) => {

                if (dialect === 'sqlite') await sql`PRAGMA busy_timeout = 1000`.execute(db);
                await bootstrapSchema(db, dialect);
                await sql`CREATE TABLE marker (value VARCHAR(20) NOT NULL)`.execute(db);
                const context = contextFor(db, dialect, root, connection);
                for (const policy of ['pipeline', 'none'] as const) {

                    if (dialect === 'mysql') {

                        await manifest(folder, policy, [`SET @noorm_pin = '${policy}'`, 'INSERT INTO marker SELECT @noorm_pin']);

                    }
                    else if (dialect === 'mssql') {

                        await manifest(folder, policy, [
                            `EXEC sys.sp_set_session_context @key=N'noorm_pin', @value=N'${policy}'`,
                            "INSERT INTO marker SELECT CONVERT(VARCHAR(20), SESSION_CONTEXT(N'noorm_pin'))",
                        ]);

                    }
                    else {

                        const name = `session_${policy}`;
                        await manifest(folder, policy, [
                            `CREATE TEMPORARY TABLE ${name} (value VARCHAR(20))`,
                            `INSERT INTO ${name} VALUES ('${policy}')`,
                            `INSERT INTO marker SELECT value FROM ${name}`,
                        ]);

                    }
                    const result = await runPipeline(context, 'refresh');
                    if (result.dryRun) throw new Error('expected admitted execution');
                    expect(result.status).toBe('success');
                    expect((await getPipelineRun(historyContext(context), result.runId))!.run.active_key).toBeNull();

                }
                const markers = await sql<{ value: string }>`SELECT value FROM marker ORDER BY value`.execute(db);
                expect(markers.rows.map((row) => row.value)).toEqual(['none', 'pipeline']);

            }), { sqliteFile: true });

        }, 60_000);

        it('recognizes controls throughout managed bodies without confusing comments or quoted strings', async () => {

            await withPipelineDatabase(dialect, async ({ db, connection }) => withProject(async (folder, root) => {

                await bootstrapSchema(db, dialect);
                await sql`CREATE TABLE marker (value VARCHAR(20) NOT NULL)`.execute(db);
                const context = contextFor(db, dialect, root, connection);
                const aliases = dialect === 'postgres' ? ['END', 'ABORT', 'PREPARE TRANSACTION']
                    : dialect === 'sqlite' ? ['END', 'RELEASE savepoint_name']
                        : dialect === 'mssql' ? ['BEGIN TRAN', 'SAVE TRAN savepoint_name'] : ['START TRANSACTION', 'SET autocommit = 1'];
                for (const policy of ['pipeline', 'step'] as const) {

                    for (const control of ['COMMIT', 'ROLLBACK', ...aliases]) {

                        const separator = dialect === 'mssql' ? '\nGO\n' : '; ';
                        await manifest(folder, policy, [markerA, `SELECT 'not COMMIT'${separator}/* comment */ ${control}`]);
                        await expect(runPipeline(context, 'refresh')).rejects.toThrow();

                    }

                }
                expect((await sql`SELECT * FROM marker`.execute(db)).rows).toHaveLength(0);
                expect((await sql`SELECT * FROM ${runTable(dialect)}`.execute(db)).rows).toHaveLength(0);
                const safe = dialect === 'mssql' ? "BEGIN SELECT 'COMMIT' AS value; END" : "SELECT 'COMMIT; ROLLBACK' AS value /* BEGIN */";
                await manifest(folder, 'pipeline', [safe]);
                const result = await runPipeline(context, 'refresh');
                expect(result.status).toBe('success');

            }), { sqliteFile: true });

        }, 60_000);

    });

}

// Throw only after the real driver's control statement has completed. This models a lost
// acknowledgement without fabricating SQL results or leaving an open transaction in the pool.
for (const dialect of ['postgres', 'mysql'] as const) {

    for (const action of ['commit', 'rollback'] as const) {

        it(`${dialect} preserves unknown outcome after lost ${action} acknowledgement`, async () => {

            await withPipelineDatabase(dialect, async ({ db, connection }) => withProject(async (folder, root) => {

                await bootstrapSchema(db, dialect);
                await sql`CREATE TABLE marker (value VARCHAR(20) NOT NULL)`.execute(db);
                let armed = false;
                const selected = new WeakSet<object>();
                const plugin: KyselyPlugin = {
                    transformQuery(args) {

                        if (armed && args.node.kind === 'RawNode' && args.node.sqlFragments.join('').trim().toLowerCase() === action) {

                            selected.add(args.queryId);

                        }

                        return args.node;

                    },
                    async transformResult(args) {

                        if (selected.has(args.queryId)) {

                            armed = false;
                            throw new Error(`lost ${action} acknowledgement`);

                        }

                        return args.result;

                    },
                };
                const context = contextFor(db.withPlugin(plugin), dialect, root, connection);
                await manifest(folder, 'pipeline', action === 'commit' ? [markerA]
                    : [markerA, 'SELECT * FROM missing_pipeline_table']);
                // Admission has its own transaction; arm only when workflow SQL starts.
                const armPlugin: KyselyPlugin = {
                    transformQuery(args) {

                        if (args.node.kind === 'RawNode' && args.node.sqlFragments.join('').includes('INSERT INTO marker')) armed = true;

                        return args.node;

                    },
                    async transformResult(args) {

                        return args.result;

                    },
                };
                context.db = context.db.withPlugin(armPlugin);
                const result = await runPipeline(context, 'refresh');
                if (result.dryRun) throw new Error('expected admitted execution');
                expect(result.transactionOutcome).toBe('unknown');
                if (action === 'commit') expect(result.primaryError).toMatchObject({ phase: 'commit' });
                else {

                    expect(result.primaryError).toMatchObject({ phase: 'execute', stepNo: 2 });
                    expect(result.secondaryErrors).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'rollback' })]));

                }
                const rows = await sql`SELECT * FROM marker`.execute(db);
                expect(rows.rows).toHaveLength(action === 'commit' ? 1 : 0);
                const saved = await getPipelineRun(historyContext(context), result.runId);
                if (action === 'commit') {

                    expect(saved!.run.transaction_outcome).toBe('unknown');
                    expect(saved!.run.active_key).toBeNull();

                }
                else {

                    expect(saved!.run.status).toBe('pending');
                    expect(saved!.run.active_key).not.toBeNull();

                }

            }));

        }, 60_000);

    }

}

// Each body hides its transaction control from a lexer, so these stay valid as the preflight
// scanner improves: the executor must prove ownership at runtime, not trust the scanner.
async function runEscape(dialect: Dialect, policy: Policy, setup: string[], bodies: string[], plugin?: KyselyPlugin) {

    return withPipelineDatabase(dialect, async ({ db, connection }) => withProject(async (folder, root) => {

        if (dialect === 'sqlite') await sql`PRAGMA busy_timeout = 1000`.execute(db);
        await bootstrapSchema(db, dialect);
        await sql`CREATE TABLE marker (value VARCHAR(20) NOT NULL)`.execute(db);
        for (const statement of setup) await sql.raw(statement).execute(db);
        await manifest(folder, policy, bodies);
        const context = contextFor(plugin ? db.withPlugin(plugin) : db, dialect, root, connection);
        const result = await runPipeline(context, 'refresh');
        if (result.dryRun) throw new Error('expected admitted execution');
        const rows = await sql<{ value: string }>`SELECT value FROM marker ORDER BY value`.execute(db);
        const saved = await getPipelineRun(historyContext(context), result.runId);

        return { result, markers: rows.rows.map((row) => row.value), saved };

    }), { sqliteFile: true });

}

// Fails the matching control query after the server ran it, as a dropped connection would.
function failingProbe(select: (fragments: string) => boolean): KyselyPlugin {

    const failing = new WeakSet<object>();

    return {
        transformQuery(args) {

            if (args.node.kind === 'RawNode' && select(args.node.sqlFragments.join(''))) failing.add(args.queryId);

            return args.node;

        },
        async transformResult(args) {

            if (failing.has(args.queryId)) throw new Error('probe connection lost');

            return args.result;

        },
    };

}

type EscapeRun = Awaited<ReturnType<typeof runEscape>>;

function expectEscaped({ result, markers, saved }: EscapeRun, escapedStep: number, expectedMarkers: string[]) {

    expect(markers).toEqual(expectedMarkers);
    expect(result.transactionOutcome).toBe('unknown');
    expect(result.status).toBe('unknown');
    expect(result.primaryError).toMatchObject({ phase: 'execute', stepNo: escapedStep });
    for (const step of result.steps) {

        const expected: [PipelineStepStatus, PipelineTransactionOutcome | 'not_started'] = step.stepNo > escapedStep ? ['skipped', 'not_started'] : [step.stepNo === escapedStep ? 'failed' : 'success', 'unknown'];
        expect([step.status, step.transactionOutcome]).toEqual(expected);

    }
    expect(saved).not.toBeNull();
    expect(saved?.run.transaction_outcome).toBe('unknown');
    expect(saved?.run.active_key).toBeNull();

}

function expectEscapeCode({ result, saved }: EscapeRun, escapedStep: number) {

    const step = result.steps[escapedStep - 1];
    expect(step?.error).toMatchObject({ code: 'TRANSACTION_ESCAPED' });
    expect(saved?.steps[escapedStep - 1]?.error_message).toContain('transaction');

}

describe('pipeline SQL boundaries: runtime transaction ownership', () => {

    const pgSteps = (third: string) => [
        markerA, 'SET standard_conforming_strings = off', third, markerC,
    ];

    it('R1 postgres: an author COMMIT behind a lexer-invisible string is detected after the step', async () => {

        const run = await runEscape('postgres', 'pipeline', [], pgSteps("SELECT 'a\\''; COMMIT; SELECT 'x'"));
        expectEscaped(run, 3, ['A']);
        expectEscapeCode(run, 3);

    }, 60_000);

    it('R2 postgres: a step that fails after the author COMMIT is unknown, not rolled_back', async () => {

        expectEscaped(await runEscape('postgres', 'pipeline', [], pgSteps("SELECT 'a\\''; COMMIT; SELECT 1/0; SELECT 'x'")), 3, ['A']);

    }, 60_000);

    it('R3 postgres: COMMIT AND CHAIN work is rolled back, never committed by noorm', async () => {

        const third = "SELECT 'a\\''; COMMIT AND CHAIN; INSERT INTO marker VALUES ('B'); SELECT 'x'";
        expectEscaped(await runEscape('postgres', 'pipeline', [], pgSteps(third)), 3, ['A']);

    }, 60_000);

    const commitProcedure = 'CREATE PROCEDURE p() BEGIN COMMIT; END';
    const failingProcedure = "CREATE PROCEDURE p() BEGIN COMMIT; SIGNAL SQLSTATE '45000'; END";
    it('R4 mysql: a procedure COMMIT is detected after the step', async () => {

        const run = await runEscape('mysql', 'pipeline', [commitProcedure], [markerA, 'CALL p()', markerC]);
        expectEscaped(run, 2, ['A']);
        expectEscapeCode(run, 2);

    }, 60_000);

    it('R5 mysql: a procedure that commits then fails is unknown, not rolled_back', async () => {

        expectEscaped(await runEscape('mysql', 'pipeline', [failingProcedure], [markerA, 'CALL p()', markerC]), 2, ['A']);

    }, 60_000);

    it('R6 mysql: step policy keeps the earlier commit and marks the escaping step unknown', async () => {

        const { result, markers } = await runEscape('mysql', 'step', [commitProcedure], [markerA, 'CALL p()']);
        expect(markers).toEqual(['A']);
        expect(result.steps.map((step) => [step.status, step.transactionOutcome])).toEqual([
            ['success', 'committed'], ['failed', 'unknown'],
        ]);
        expect(result.transactionOutcome).toBe('partial');

    }, 60_000);

    it('R7 mssql: a dynamic COMMIT and BEGIN TRAN is detected by transaction id', async () => {

        const run = await runEscape('mssql', 'pipeline', [], [markerA, "EXEC('COMMIT; BEGIN TRAN')", markerC]);
        expectEscaped(run, 2, ['A']);
        expectEscapeCode(run, 2);

    }, 60_000);

    it('R8 mssql: a dynamic COMMIT followed by a failure is unknown, not rolled_back', async () => {

        expectEscaped(await runEscape('mssql', 'pipeline', [], [markerA, "EXEC('COMMIT; BEGIN TRAN'); THROW 50000, 'fail', 1;"]), 2, ['A']);

    }, 60_000);

    it('R9 mssql: an unbalanced nested BEGIN TRAN is still noorm\'s transaction and rolls back', async () => {

        const { result, markers } = await runEscape('mssql', 'pipeline', [], [markerA, "EXEC('BEGIN TRAN')"]);
        expect(markers).toEqual([]);
        expect(result.steps.map((step) => [step.status, step.transactionOutcome])).toEqual([
            ['success', 'rolled_back'], ['failed', 'rolled_back'],
        ]);
        expect(result.transactionOutcome).toBe('rolled_back');

    }, 60_000);

    it('R10 sqlite: a trigger RAISE(ROLLBACK) stays unknown with the work undone', async () => {

        const trigger = "CREATE TRIGGER abort_x BEFORE INSERT ON marker WHEN NEW.value = 'X' BEGIN SELECT RAISE(ROLLBACK, 'x'); END";
        const { result, markers } = await runEscape('sqlite', 'pipeline', [trigger], [markerA, "INSERT INTO marker VALUES ('X')"]);
        expect(markers).toEqual([]);
        expect(result.transactionOutcome).toBe('unknown');

    }, 60_000);

    function expectUnverified({ result, markers, saved }: EscapeRun, { guardReleased = false } = {}) {

        expect(markers).toEqual([]);
        expect(result.transactionOutcome).toBe('unknown');
        expect(result.primaryError?.code).not.toBe('TRANSACTION_ESCAPED');
        const errors = [result.primaryError, ...result.secondaryErrors];
        expect(errors.some((error) => error?.phase === 'cleanup' && error.code === 'OWNERSHIP_UNVERIFIED')).toBe(true);
        expect(result.steps.every((step) => step.transactionOutcome === 'unknown')).toBe(true);
        if (guardReleased) expect(saved?.run.active_key).toBeNull();
        else {

            expect(saved?.run.status).toBe('pending');
            expect(saved?.run.active_key).not.toBeNull();

        }

    }

    it('postgres: a failed post-step probe is not an escape and keeps the single-run guard', async () => {

        let reads = 0;
        const run = await runEscape(
            'postgres', 'pipeline', [], [markerA], failingProbe((fragments) => fragments.includes('pg_current_xact_id') && ++reads === 2),
        );
        expectUnverified(run);
        expect(run.result.primaryError).toMatchObject({ phase: 'cleanup', stepNo: 1 });

    }, 60_000);

    it('postgres: a failed pre-rollback probe is not proof of ownership and keeps the guard', async () => {

        const run = await runEscape(
            'postgres', 'pipeline', [], [markerA, 'SELECT * FROM missing_pipeline_table'],
            failingProbe((fragments) => fragments.startsWith('ROLLBACK TO SAVEPOINT')),
        );
        expectUnverified(run);

    }, 60_000);

    it('mysql: an unrecognized RELEASE SAVEPOINT error is unverified and keeps the guard', async () => {

        const run = await runEscape(
            'mysql', 'pipeline', [], [markerA], failingProbe((fragments) => fragments.startsWith('RELEASE SAVEPOINT')),
        );
        expectUnverified(run);

    }, 60_000);

    it('mysql: an unrecognized ROLLBACK TO SAVEPOINT error is unverified and keeps the guard', async () => {

        const run = await runEscape(
            'mysql', 'pipeline', [], [markerA, 'SELECT * FROM missing_pipeline_table'],
            failingProbe((fragments) => fragments.startsWith('ROLLBACK TO SAVEPOINT')),
        );
        expectUnverified(run);

    }, 60_000);

    it('mssql: a failed transaction state read is unverified, still rolls back, and keeps the guard', async () => {

        let reads = 0;
        const run = await runEscape(
            'mssql', 'pipeline', [], [markerA], failingProbe((fragments) => fragments.includes('CURRENT_TRANSACTION_ID') && ++reads >= 2),
        );
        expectUnverified(run);

    }, 60_000);

    it('sqlite: a failed RELEASE SAVEPOINT stays unknown, and the quiescence probe releases the guard', async () => {

        const run = await runEscape(
            'sqlite', 'pipeline', [], [markerA], failingProbe((fragments) => fragments.startsWith('RELEASE SAVEPOINT')),
        );
        expectUnverified(run, { guardReleased: true });

    }, 60_000);

});

describe('pipeline SQL boundaries: setup and cleanup failures', () => {

    function expectNothingStarted({ result, markers }: EscapeRun) {

        expect(markers).toEqual([]);
        expect(result.status).toBe('failed');
        expect(result.transactionOutcome).toBe('no_effects');
        expect(result.primaryError).toMatchObject({ phase: 'execute' });
        expect(result.primaryError?.stepNo).toBeUndefined();
        expect(result.steps.map((step) => [step.status, step.transactionOutcome])).toEqual([['skipped', 'not_started']]);

    }

    for (const dialect of ['postgres', 'mysql'] as const) {

        it(`${dialect}: a BEGIN whose acknowledgement is lost starts nothing and keeps the guard`, async () => {

            const run = await runEscape(dialect, 'pipeline', [], [markerA], failingProbe((fragments) => fragments === 'begin'));
            expectNothingStarted(run);
            expect(run.saved?.run.status).toBe('pending');
            expect(run.saved?.run.active_key).not.toBeNull();

        }, 60_000);

    }

    const markerFailures = [
        ['postgres', 'SAVEPOINT'], ['mysql', 'SAVEPOINT'], ['sqlite', 'SAVEPOINT'], ['mssql', 'CURRENT_TRANSACTION_ID'],
    ] as const;

    for (const [dialect, statement] of markerFailures) {

        it(`${dialect}: a failed ownership marker rolls the setup back and releases the guard`, async () => {

            const run = await runEscape(dialect, 'pipeline', [], [markerA], failingProbe((fragments) => fragments.includes(statement)));
            expectNothingStarted(run);
            expect(run.saved?.run.status).toBe('failed');
            expect(run.saved?.run.active_key).toBeNull();

        }, 60_000);

    }

    const authorTransactions = [
        ['mysql', ['START TRANSACTION', markerA, 'COMMIT'], 'SET autocommit = 1'],
        ['mssql', ["BEGIN TRANSACTION; INSERT INTO marker VALUES ('A'); COMMIT TRANSACTION"], 'SET IMPLICIT_TRANSACTIONS OFF'],
    ] as const;

    for (const [dialect, bodies, statement] of authorTransactions) {

        it(`${dialect}: a failed end of the author's transaction is unknown and keeps the guard`, async () => {

            const run = await runEscape(dialect, 'none', [], [...bodies], failingProbe((fragments) => fragments === statement));
            expect(run.result.status).toBe('unknown');
            expect(run.result.transactionOutcome).toBe('unknown');
            expect(run.result.steps.every((step) => step.transactionOutcome === 'unknown')).toBe(true);
            expect([run.result.primaryError, ...run.result.secondaryErrors].some((error) => error?.phase === 'cleanup')).toBe(true);
            expect(run.saved?.run.status).toBe('pending');
            expect(run.saved?.run.active_key).not.toBeNull();

        }, 60_000);

    }

});
