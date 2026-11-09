import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'kysely';

import type { Config } from '../../../src/core/config/types.js';
import type { Dialect } from '../../../src/core/connection/types.js';
import { generateKeyPair } from '../../../src/core/identity/index.js';
import { clearKeyOverride, setKeyOverride } from '../../../src/core/identity/storage.js';
import { resetSettingsManager } from '../../../src/core/settings/index.js';
import { getNoormTables, type NoormDatabase } from '../../../src/core/shared/tables.js';
import { getStateManager, resetStateManager } from '../../../src/core/state/index.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';
import { createContext } from '../../../src/sdk/index.js';
import type { Context } from '../../../src/sdk/context.js';
import { extractJsonObject } from '../../cli/run/_setup.js';
import { withPipelineDatabase } from '../../utils/pipeline-db.js';

const dialects: Dialect[] = ['sqlite', 'postgres', 'mysql', 'mssql'];
const secret = 'private-caller-value-9327';
const statement = 'INSERT INTO caller_marker';
const repo = resolve(import.meta.dir, '../../..');

// Isolate the SDK's process-wide state, settings and identity overrides from other suites.
if (!process.env['PIPELINE_CALLER_TEST_CHILD']) {

    it('exercises actual SDK and CLI callers in an isolated process', async () => {

        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NOORM_')));
        env['PIPELINE_CALLER_TEST_CHILD'] = '1';
        const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
            cwd: repo, env, stdout: 'pipe', stderr: 'pipe',
        });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
        ]);
        expect({ exitCode, output: exitCode === 0 ? '' : stdout + stderr }).toEqual({ exitCode: 0, output: '' });

    }, 300_000);

}
else {

    for (const dialect of dialects) {

        describe(`pipeline actual caller parity: ${dialect}`, () => {

            it('shares protected fresh executions, scoped history, dry runs and privacy', async () => {

                await withPipelineDatabase(dialect, async ({ db, connection }) => {

                    const root = await mkdtemp(join(tmpdir(), 'noorm-caller-parity-'));
                    const contexts: Context<NoormDatabase>[] = [];
                    let disconnected: PromiseSettledResult<unknown>[];
                    try {

                        const folder = join(root, 'db', 'pipelines', 'refresh');
                        await mkdir(folder, { recursive: true });
                        await mkdir(join(root, '.noorm'), { recursive: true });
                        await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({
                            transaction: 'step', singleRun: true,
                            inputs: { value: { type: 'string', description: 'Marker', required: true } },
                            steps: [{ id: 'first', sql: 'insert.sql.tmpl' }, { id: 'again', sql: 'insert.sql.tmpl' }],
                        }));
                        await writeFile(join(folder, 'insert.sql.tmpl'),
                            `${statement} (value) VALUES ({%~ $.quote($.input.value) %})`);

                        resetStateManager();
                        resetSettingsManager();
                        const privateKey = generateKeyPair().privateKey;
                        setKeyOverride(privateKey);
                        const identity = {
                            NOORM_IDENTITY_PRIVATE_KEY: privateKey,
                            NOORM_IDENTITY_NAME: 'Pipeline Test',
                            NOORM_IDENTITY_EMAIL: 'pipeline-test@example.invalid',
                        };
                        Object.assign(process.env, identity);
                        const state = getStateManager(root);
                        await state.load();
                        const config = (name: string): Config => ({
                            name, type: 'local', isTest: true,
                            access: { user: 'admin', agent: 'admin' }, connection,
                        });
                        await state.setConfig('alpha', config('alpha'));
                        await state.setConfig('beta', config('beta'));
                        await bootstrapSchema(db, dialect);
                        await sql`CREATE TABLE caller_marker (value VARCHAR(100) NOT NULL)`.execute(db);

                        const open = async (name: string) => {

                            const context = await createContext<NoormDatabase>({
                                projectRoot: root, config: name, requireTest: true,
                            });
                            contexts.push(context);
                            await context.connect();

                            return context;

                        };
                        const alpha = await open('alpha');
                        const beta = await open('beta');
                        const cli = (...args: string[]) => spawnSync('node', [
                            join(repo, 'dist/cli/index.js'), '--cwd', root, 'pipeline', ...args,
                        ], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...identity }, timeout: 30_000 });
                        const parse = (stdout: string): Record<string, unknown> => {

                            const json = extractJsonObject(stdout);
                            if (json === null) throw new Error(`Missing JSON CLI response: ${stdout}`);

                            return JSON.parse(json) as Record<string, unknown>;

                        };
                        const privateOutput = (output: string) => {

                            expect(output).not.toContain(secret);
                            expect(output).not.toContain(statement);

                        };
                        const names = getNoormTables(dialect);
                        const table = (name: string) => sql.table(
                            dialect === 'postgres' || dialect === 'mssql' ? `noorm.${name}` : name,
                        );
                        const genericHistory = async () => ({
                            changes: (await sql`SELECT * FROM ${table(names.change)}`.execute(db)).rows,
                            executions: (await sql`SELECT * FROM ${table(names.executions)}`.execute(db)).rows,
                        });
                        const markers = async () => (await sql<{ value: string }>`
                            SELECT value FROM caller_marker ORDER BY value
                        `.execute(db)).rows.map((row) => row.value);
                        expect(await genericHistory()).toEqual({ changes: [], executions: [] });

                        const sdk = await alpha.noorm.pipelines.run('refresh', { input: { value: 'sdk-marker' } });
                        expect(sdk.dryRun).toBe(false);
                        if (sdk.dryRun) throw new Error('Expected an admitted SDK run');
                        expect(sdk.status).toBe('success');
                        const command = cli('run', 'refresh', '--config', 'alpha', '--value', secret, '--json', '--yes');
                        expect(command.status).toBe(0);
                        const result = parse(command.stdout);
                        expect(result).toMatchObject({ success: true, status: 'success', dryRun: false });
                        expect(typeof result['runId']).toBe('number');
                        const cliId = result['runId'] as number;
                        expect(cliId).not.toBe(sdk.runId);
                        privateOutput(command.stdout + command.stderr);
                        expect(await markers()).toEqual([secret, secret, 'sdk-marker', 'sdk-marker']);

                        const history = await alpha.noorm.pipelines.history('refresh', {});
                        expect(history.map((run) => run.id)).toEqual([cliId, sdk.runId]);
                        expect((await alpha.noorm.pipelines.history('refresh', { limit: 1 })).map((run) => run.id))
                            .toEqual([cliId]);
                        await expect(alpha.noorm.pipelines.history('refresh', { limit: 0 })).rejects.toThrow();
                        await expect(alpha.noorm.pipelines.history('refresh', { limit: 101 })).rejects.toThrow();
                        const record = await alpha.noorm.pipelines.getRun(cliId);
                        expect(record?.run.id).toBe(cliId);
                        expect(record?.steps.map((step) => [step.step_no, step.name, step.status]))
                            .toEqual([[1, 'first', 'success'], [2, 'again', 'success']]);
                        privateOutput(JSON.stringify({ history, record }));
                        expect(await beta.noorm.pipelines.history('refresh', {})).toEqual([]);
                        expect(await beta.noorm.pipelines.getRun(cliId)).toBeNull();
                        const show = cli('show', String(cliId), '--config', 'alpha', '--json');
                        expect(show.status).toBe(0);
                        expect(parse(show.stdout)).toMatchObject({ success: true, run: { id: cliId } });
                        privateOutput(show.stdout + show.stderr);
                        const foreignShow = cli('show', String(cliId), '--config', 'beta', '--json');
                        expect(foreignShow.status).toBe(1);
                        expect(parse(foreignShow.stdout)).toMatchObject({ success: false });
                        privateOutput(foreignShow.stdout + foreignShow.stderr);

                        const dry = cli('run', 'refresh', '--config', 'alpha', '--value', secret, '--dry-run', '--json', '--yes');
                        expect(dry.status).toBe(0);
                        expect(parse(dry.stdout)).toMatchObject({ success: true, dryRun: true, runId: null });
                        privateOutput(dry.stdout + dry.stderr);
                        expect(await markers()).toEqual([secret, secret, 'sdk-marker', 'sdk-marker']);
                        expect((await alpha.noorm.pipelines.history('refresh', {})).map((run) => run.id))
                            .toEqual([cliId, sdk.runId]);
                        expect(await genericHistory()).toEqual({ changes: [], executions: [] });

                    }
                    finally {

                        disconnected = await Promise.allSettled(contexts.map((context) => context.disconnect()));
                        clearKeyOverride();
                        resetStateManager();
                        resetSettingsManager();
                        delete process.env['NOORM_IDENTITY_PRIVATE_KEY'];
                        delete process.env['NOORM_IDENTITY_NAME'];
                        delete process.env['NOORM_IDENTITY_EMAIL'];
                        await rm(root, { recursive: true, force: true });

                    }
                    const failure = disconnected.find((result) => result.status === 'rejected');
                    if (failure?.status === 'rejected') throw failure.reason;

                }, { sqliteFile: true });

            }, 60_000);

        });

    }

}
