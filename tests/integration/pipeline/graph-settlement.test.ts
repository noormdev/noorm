import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type KyselyPlugin } from 'kysely';
import type { ConnectionConfig, Dialect } from '../../../src/core/connection/types.js';
import { runPipeline } from '../../../src/core/pipeline/executor.js';
import { getPipelineRun } from '../../../src/core/pipeline/history.js';
import type { PipelineContext } from '../../../src/core/pipeline/types.js';
import { getNoormTables } from '../../../src/core/shared/tables.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';
import { withPipelineDatabase } from '../../utils/pipeline-db.js';
import { withPolicy } from '../../utils/access.js';

const dialects: Dialect[] = ['sqlite', 'postgres', 'mysql', 'mssql'];
type Policy = 'pipeline' | 'step' | 'none';

async function withProject<T>(body: (folder: string, root: string) => Promise<T>): Promise<T> {

    const root = await mkdtemp(join(tmpdir(), 'noorm-graph-'));
    try {

        const folder = join(root, 'db', 'pipelines', 'graph');
        await mkdir(folder, { recursive: true });

        return await body(folder, root);

    }
    finally {

        await rm(root, { recursive: true, force: true });

    }

}

function contextFor(db: PipelineContext['db'], dialect: Dialect, root: string, connectionConfig: ConnectionConfig, poolMax: number): PipelineContext {

    return { db, dialect, connectionConfig, poolMax, configName: 'graph-test', identity: { name: 'test', source: 'config' },
        projectRoot: root, access: withPolicy({ user: 'admin', agent: 'admin' }), channel: 'user',
        pipelinesPath: './db/pipelines', cliVersion: 'test' };

}

function historyContext(context: PipelineContext) {

    return { db: context.db, dialect: context.dialect, configName: context.configName, executedBy: 'test', cliVersion: 'test' };

}

async function definition(folder: string, transaction: Policy, concurrency: number, steps: { id: string; needs: string[]; body: string }[]) {

    await Promise.all(steps.map((step) => writeFile(join(folder, `${step.id}.sql`), step.body)));
    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({ transaction, concurrency, singleRun: true,
        steps: steps.map(({ id, needs }) => ({ id, needs, sql: `${id}.sql` })) }));

}

function insert(dialect: Dialect, name: string): string {

    const session = dialect === 'postgres' ? 'CAST(pg_backend_pid() AS VARCHAR(30))'
        : dialect === 'mysql' ? 'CAST(CONNECTION_ID() AS CHAR)'
            : dialect === 'mssql' ? 'CAST(@@SPID AS VARCHAR(30))' : "'sqlite'";

    return `INSERT INTO marker (name, session_id) VALUES ('${name}', ${session})`;

}

// Hold the acknowledgement of real, completed driver queries. The database results
// are passed through unchanged; a timeout only bounds broken-test cleanup.
function acknowledgementGate(names: string[]) {

    const selected = new WeakMap<object, string>();
    const waiting = new Map<string, () => void>();
    const arrivals = new Set<string>();
    let changed: (() => void) | undefined;
    let active = 0;
    let peak = 0;
    let released = false;
    const plugin: KyselyPlugin = {
        transformQuery(args) {

            if (args.node.kind === 'RawNode') {

                const text = args.node.sqlFragments.join('');
                const name = names.find((item) => text.includes(`VALUES ('${item}',`));
                if (name) selected.set(args.queryId, name);

            }

            return args.node;

        },
        async transformResult(args) {

            const name = selected.get(args.queryId);
            if (name && !released) {

                active++;
                peak = Math.max(peak, active);
                arrivals.add(name);
                const { promise, resolve } = Promise.withResolvers<void>();
                waiting.set(name, resolve);
                changed?.();
                await promise;
                active--;

            }

            return args.result;

        },
    };

    return {
        plugin,
        get peak() {

            return peak;

        },
        async waitFor(count: number) {

            const deadline = Date.now() + 15_000;
            while (arrivals.size < count) {

                const remaining = deadline - Date.now();
                if (remaining <= 0) throw new Error(`Timed out waiting for ${count} SQL acknowledgements`);
                // This deadline detects a deadlocked real database test; it never drives scheduling.
                const { promise, resolve, reject } = Promise.withResolvers<void>();
                const timer = setTimeout(() => reject(new Error('Timed out waiting for SQL acknowledgement')), remaining);
                changed = () => {

                    clearTimeout(timer); changed = undefined; resolve();

                };
                await promise;

            }

        },
        release(name: string) {

            waiting.get(name)?.(); waiting.delete(name);

        },
        releaseAll() {

            released = true; for (const resolve of waiting.values()) resolve(); waiting.clear();

        },
    };

}

for (const dialect of dialects) {

    describe(`pipeline graph settlement: ${dialect}`, () => {

        for (const policy of ['pipeline', 'step', 'none'] as const) {

            it(`${policy} respects graph and pool concurrency and joins only after both branches`, async () => {

                await withPipelineDatabase(dialect, async ({ db, connection }) => withProject(async (folder, root) => {

                    await bootstrapSchema(db, dialect);
                    await sql`CREATE TABLE marker (name VARCHAR(20) NOT NULL, session_id VARCHAR(30) NOT NULL)`.execute(db);
                    await definition(folder, policy, 8, [
                        { id: 'a', needs: [], body: insert(dialect, 'a') },
                        { id: 'b', needs: [], body: insert(dialect, 'b') },
                        { id: 'join', needs: ['a', 'b'], body: "INSERT INTO marker SELECT 'join', 'joined' WHERE (SELECT COUNT(*) FROM marker WHERE name IN ('a', 'b')) = 2" },
                    ]);
                    const gate = acknowledgementGate(['a', 'b']);
                    const cap = dialect === 'sqlite' || policy === 'pipeline' ? 1 : 2;
                    const context = contextFor(db.withPlugin(gate.plugin), dialect, root, connection, 2);
                    const running = runPipeline(context, 'graph');
                    try {

                        await gate.waitFor(cap);
                        if (cap === 1) {

                            gate.release('a');
                            await gate.waitFor(2);
                            gate.release('b');

                        }
                        else gate.releaseAll();
                        const result = await running;
                        if (result.dryRun) throw new Error('expected execution');
                        expect(result.concurrency).toBe(cap);
                        expect(gate.peak).toBe(cap);
                        expect(result.status).toBe('success');
                        expect(result.transactionOutcome).toBe('committed');
                        const rows = (await sql<{ name: string; session_id: string }>`
                            SELECT name, session_id FROM marker ORDER BY name
                        `.execute(db)).rows;
                        expect(rows.map((row) => row.name)).toEqual(['a', 'b', 'join']);
                        if (dialect !== 'sqlite') expect(rows[0]!.session_id === rows[1]!.session_id).toBe(cap === 1);
                        const saved = await getPipelineRun(historyContext(context), result.runId);
                        expect(saved!.run.active_key).toBeNull();
                        expect(saved!.steps.map((step) => [step.step_no, step.status, step.transaction_outcome])).toEqual([
                            [1, 'success', 'committed'], [2, 'success', 'committed'], [3, 'success', 'committed'],
                        ]);
                        expect(saved!.steps.map((step) => JSON.parse(step.needs))).toEqual([[], [], [1, 2]]);

                    }
                    finally {

                        gate.releaseAll(); await running.catch(() => undefined);

                    }

                }), { sqliteFile: true });

            }, 60_000);

        }

        for (const reason of ['failure', 'abort'] as const) {

            it(`${reason} stops future work and retains the guard until started SQL settles`, async () => {

                await withPipelineDatabase(dialect, async ({ db, connection }) => withProject(async (folder, root) => {

                    await bootstrapSchema(db, dialect);
                    await sql`CREATE TABLE marker (name VARCHAR(20) NOT NULL, session_id VARCHAR(30) NOT NULL)`.execute(db);
                    const parallel = dialect !== 'sqlite';
                    await definition(folder, 'step', 2, [
                        { id: 'a', needs: [], body: insert(dialect, 'a') },
                        { id: 'b', needs: parallel && reason === 'failure' ? [] : ['a'], body: reason === 'failure' ? 'SELECT * FROM missing_graph_table' : insert(dialect, 'b') },
                        { id: 'c', needs: ['b'], body: insert(dialect, 'c') },
                    ]);
                    const gate = acknowledgementGate(['a']);
                    const context = contextFor(db.withPlugin(gate.plugin), dialect, root, connection, 2);
                    const controller = new AbortController();
                    let finished = false;
                    const running = runPipeline(context, 'graph', { signal: controller.signal }).finally(() => {

                        finished = true;

                    });
                    try {

                        await gate.waitFor(1);
                        if (reason === 'abort') controller.abort();
                        const table = getNoormTables(dialect).pipelineRun;
                        const ref = sql.table(dialect === 'postgres' || dialect === 'mssql' ? `noorm.${table}` : table);
                        const pending = await sql<{ active_key: string | null }>`SELECT active_key FROM ${ref}`.execute(db);
                        expect(pending.rows).toHaveLength(1);
                        expect(pending.rows[0]!.active_key).not.toBeNull();
                        expect(finished).toBe(false);
                        gate.releaseAll();
                        const result = await running;
                        if (result.dryRun) throw new Error('expected execution');
                        expect(result.status).toBe(reason === 'abort' ? 'interrupted' : 'partial');
                        expect(result.steps[0]).toMatchObject({ status: 'success', transactionOutcome: 'committed' });
                        expect(result.steps[2]).toMatchObject({ status: 'skipped', transactionOutcome: 'not_started' });
                        if (reason === 'failure') expect(result.steps[1]).toMatchObject({ status: 'failed', transactionOutcome: 'rolled_back' });
                        const rows = (await sql<{ name: string }>`SELECT name FROM marker ORDER BY name`.execute(db)).rows.map((row) => row.name);
                        expect(rows).toContain('a');
                        expect(rows).not.toContain('c');
                        const saved = await getPipelineRun(historyContext(context), result.runId);
                        expect(saved!.run.active_key).toBeNull();
                        expect(saved!.run.transaction_outcome).toBe(result.transactionOutcome);
                        expect(saved!.steps.map((step) => step.step_no)).toEqual([1, 2, 3]);
                        expect(saved!.steps.map((step) => step.status)).toEqual(result.steps.map((step) => step.status));

                    }
                    finally {

                        gate.releaseAll(); await running.catch(() => undefined);

                    }

                }), { sqliteFile: true });

            }, 60_000);

        }

    });

}
