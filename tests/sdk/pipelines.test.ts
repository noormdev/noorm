import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'kysely';

import { generateKeyPair } from '../../src/core/identity/index.js';
import { clearKeyOverride, setKeyOverride } from '../../src/core/identity/storage.js';
import { getStateManager, resetStateManager } from '../../src/core/state/index.js';
import { resetSettingsManager } from '../../src/core/settings/index.js';
import type { NoormDatabase } from '../../src/core/shared/tables.js';
import { bootstrapSchema, tablesExist } from '../../src/core/version/schema/index.js';
import { CURRENT_VERSIONS, VersionMismatchError } from '../../src/core/version/types.js';
import { createContext } from '../../src/sdk/index.js';
import type { Context } from '../../src/sdk/context.js';
import type { Config } from '../../src/core/config/types.js';

// Child processes isolate shared identity/state providers from other suites and user keys.
if (!process.env['PIPELINE_SDK_TEST_CHILD']) {

    it('exercises SDK pipeline workflows in an isolated process', async () => {

        const env = Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith('NOORM_')),
        );
        env['PIPELINE_SDK_TEST_CHILD'] = '1';
        const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
            cwd: resolve(import.meta.dir, '../..'), env, stdout: 'pipe', stderr: 'pipe',
        });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
        ]);
        expect({ exitCode, output: exitCode === 0 ? '' : stdout + stderr }).toEqual({ exitCode: 0, output: '' });

    }, 60000);

}
else {

    describe('sdk: connected pipelines', () => {

        let root: string;
        let folder: string;
        let ctx: Context<NoormDatabase>;
        let contexts: Context<NoormDatabase>[];

        beforeEach(async () => {

            root = await mkdtemp(join(tmpdir(), 'noorm-sdk-pipelines-'));
            folder = join(root, 'db', 'pipelines', 'refresh');
            await mkdir(folder, { recursive: true });
            await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({
                transaction: 'step',
                inputs: {
                    name: { type: 'string', description: 'Name', required: true },
                    count: { type: 'integer', description: 'Count', default: 7 },
                    enabled: { type: 'boolean', description: 'Enabled', default: true },
                },
                steps: [{ id: 'first', sql: 'insert.sql.tmpl' }, { id: 'again', sql: 'insert.sql.tmpl' }],
            }));
            await writeFile(join(folder, 'input.json'), JSON.stringify({ name: 'wrong adjacent input' }));
            await writeFile(join(folder, 'value.sql.tmpl'), '{%~ $.quote($.input.name) %}');
            await writeFile(join(folder, 'insert.sql.tmpl'),
                "INSERT INTO marker (name, count, enabled) VALUES ({%~ await $.include('value.sql.tmpl') %}, {%~ $.input.count %}, {%~ $.input.enabled ? 1 : 0 %})");

            resetStateManager();
            resetSettingsManager();
            setKeyOverride(generateKeyPair().privateKey);
            const state = getStateManager(root);
            await state.load();
            const connection = { dialect: 'sqlite' as const, database: join(root, 'database.sqlite') };
            const config = (name: string, access: Config['access']): Config => ({
                name, type: 'local', isTest: false, access, connection,
            });
            await state.setConfig('alpha', config('alpha', { user: 'admin', agent: 'admin' }));
            await state.setConfig('beta', config('beta', { user: 'admin', agent: 'admin' }));
            await state.setConfig('viewer', config('viewer', { user: 'viewer', agent: 'viewer' }));
            await state.setConfig('operator', config('operator', { user: 'operator', agent: 'operator' }));
            ctx = await createContext<NoormDatabase>({ projectRoot: root, config: 'alpha' });
            contexts = [ctx];
            await ctx.connect();
            await bootstrapSchema(ctx.kysely, 'sqlite');
            await sql`CREATE TABLE marker (name TEXT NOT NULL, count INTEGER NOT NULL, enabled INTEGER NOT NULL)`.execute(ctx.kysely);

        });

        afterEach(async () => {

            for (const context of contexts ?? []) await context.disconnect();
            clearKeyOverride();
            resetStateManager();
            resetSettingsManager();
            await rm(root, { recursive: true, force: true });

        });

        async function open(config: string, options: { yes?: boolean; channel?: 'user' | 'agent' } = {}) {

            const context = await createContext<NoormDatabase>({ projectRoot: root, config, ...options });
            contexts.push(context);
            await context.connect();

            return context;

        }

        async function markers() {

            return (await sql<{ name: string; count: number; enabled: number }>`
                SELECT name, count, enabled FROM marker ORDER BY rowid
            `.execute(ctx.kysely)).rows;

        }

        for (const slug of ['history', 'show', 'run']) {

            it(`executes fresh SDK workflows and reads history named ${slug}`, async () => {

                const named = join(root, 'db', 'pipelines', slug);
                await mkdir(named);
                await writeFile(join(named, 'pipeline.yml'), JSON.stringify({
                    steps: [{ id: 'marker', sql: 'marker.sql' }],
                }));
                await writeFile(join(named, 'marker.sql'),
                    `INSERT INTO marker (name, count, enabled) VALUES ('${slug}', 0, 0)`);
                const first = await ctx.noorm.pipelines.run(slug);
                const second = await ctx.noorm.pipelines.run(slug);
                if (first.dryRun || second.dryRun) throw new Error('Expected admitted SDK pipeline runs');
                expect(first.status).toBe('success');
                expect(second.status).toBe('success');
                expect(first.runId).not.toBe(second.runId);
                expect((await ctx.noorm.pipelines.history(slug, {})).map((run) => run.id))
                    .toEqual([second.runId, first.runId]);
                expect(await markers()).toEqual([
                    { name: slug, count: 0, enabled: 0 }, { name: slug, count: 0, enabled: 0 },
                ]);

            });

        }

        it('renders typed inputs and defaults on every fresh invocation and scopes independent history', async () => {

            const first = await ctx.noorm.pipelines.run('refresh', { input: { name: "O'Brien" } });
            const second = await ctx.noorm.pipelines.run('refresh', {
                input: { name: 'second', count: 0, enabled: false },
            });
            if (first.dryRun || second.dryRun) throw new Error('Expected admitted runs');
            expect(first.status).toBe('success');
            expect(second.status).toBe('success');
            expect(first.runId).not.toBe(second.runId);
            expect(await markers()).toEqual([
                { name: "O'Brien", count: 7, enabled: 1 }, { name: "O'Brien", count: 7, enabled: 1 },
                { name: 'second', count: 0, enabled: 0 }, { name: 'second', count: 0, enabled: 0 },
            ]);
            const history = await ctx.noorm.pipelines.history('refresh', { limit: 1 });
            expect(history.map((run) => run.id)).toEqual([second.runId]);
            expect((await ctx.noorm.pipelines.history('refresh', {})).map((run) => run.id))
                .toEqual([second.runId, first.runId]);
            const record = await ctx.noorm.pipelines.getRun(first.runId);
            expect(record?.run.id).toBe(first.runId);
            expect(record?.steps.map((step) => [step.step_no, step.name, step.status])).toEqual([
                [1, 'first', 'success'], [2, 'again', 'success'],
            ]);
            expect(JSON.stringify(record)).not.toContain("O'Brien");
            expect(JSON.stringify(record)).not.toContain('INSERT INTO marker');

            const beta = await open('beta');
            expect(await beta.noorm.pipelines.history('refresh', {})).toEqual([]);
            expect(await beta.noorm.pipelines.getRun(first.runId)).toBeNull();
            const other = await beta.noorm.pipelines.run('refresh', { input: { name: 'beta' } });
            if (other.runId === null) throw new Error('Expected an admitted run');
            expect((await beta.noorm.pipelines.history('refresh', {})).map((run) => run.id)).toEqual([other.runId]);
            expect(await ctx.noorm.pipelines.getRun(other.runId)).toBeNull();

        });

        it('prepares dry runs without SQL or history and rejects invalid SDK input before admission', async () => {

            const dry = await ctx.noorm.pipelines.run('refresh', { input: { name: 'preview' }, dryRun: true });
            expect(dry.dryRun).toBe(true);
            expect(dry.runId).toBeNull();
            expect(dry.steps.map((step) => step.name)).toEqual(['first', 'again']);
            expect(await markers()).toEqual([]);
            expect(await ctx.noorm.pipelines.history('refresh', {})).toEqual([]);
            await expect(ctx.noorm.pipelines.run('refresh', { input: { name: 'x', count: '7' } })).rejects.toThrow();
            await expect(ctx.noorm.pipelines.run('refresh', { input: {} })).rejects.toThrow();
            expect(await markers()).toEqual([]);
            expect(await ctx.noorm.pipelines.history('refresh', {})).toEqual([]);

        });

        it('should leave a database with no tracking tables untouched on a dry run', async () => {

            await getStateManager(root).setConfig('fresh', {
                name: 'fresh', type: 'local', isTest: false, access: { user: 'admin', agent: 'admin' },
                connection: { dialect: 'sqlite', database: join(root, 'fresh.sqlite') },
            });
            const fresh = await open('fresh');

            const dry = await fresh.noorm.pipelines.run('refresh', { input: { name: 'preview' }, dryRun: true });

            expect(dry.dryRun).toBe(true);
            expect((await sql`SELECT name FROM sqlite_master WHERE type = 'table'`.execute(fresh.kysely)).rows).toEqual([]);

        });

        it('honors an already-aborted signal without executing workflow SQL', async () => {

            const controller = new AbortController();
            controller.abort();
            const result = await ctx.noorm.pipelines.run('refresh', {
                input: { name: 'not executed' }, signal: controller.signal,
            });
            expect(result.dryRun).toBe(false);
            if (result.dryRun) throw new Error('Expected an admitted run');
            expect(result.status).toBe('interrupted');
            expect(result.steps.map((step) => step.status)).toEqual(['skipped', 'skipped']);
            expect(await markers()).toEqual([]);
            const record = await ctx.noorm.pipelines.getRun(result.runId);
            expect(record?.run.status).toBe('interrupted');

        });

        it('returns admitted execution failures with durable ordered results', async () => {

            await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({
                transaction: 'step', steps: [
                    { id: 'first', sql: 'first.sql' }, { id: 'bad', sql: 'bad.sql' }, { id: 'last', sql: 'last.sql' },
                ],
            }));
            await writeFile(join(folder, 'first.sql'), "INSERT INTO marker VALUES ('first', 1, 1)");
            await writeFile(join(folder, 'bad.sql'), 'INSERT INTO missing_table VALUES (1)');
            await writeFile(join(folder, 'last.sql'), "INSERT INTO marker VALUES ('last', 1, 1)");
            const result = await ctx.noorm.pipelines.run('refresh', {});
            expect(result.dryRun).toBe(false);
            if (result.dryRun) throw new Error('Expected an admitted run');
            expect(result.status).toBe('partial');
            expect(result.primaryError).not.toBeNull();
            expect(result.steps.map((step) => step.status)).toEqual(['success', 'failed', 'skipped']);
            expect(await markers()).toEqual([{ name: 'first', count: 1, enabled: 1 }]);
            const record = await ctx.noorm.pipelines.getRun(result.runId);
            expect(record?.run.status).toBe('partial');
            expect(record?.steps.map((step) => step.status)).toEqual(['success', 'failed', 'skipped']);

        });

        async function openFreshDatabase(name: string) {

            await getStateManager(root).setConfig(name, {
                name, type: 'local', isTest: true, access: { user: 'admin', agent: 'admin' },
                connection: { dialect: 'sqlite', database: join(root, `${name}.sqlite`) },
            });
            const plain = join(root, 'db', 'pipelines', 'plain');
            await mkdir(plain, { recursive: true });
            await writeFile(join(plain, 'pipeline.yml'), JSON.stringify({ steps: [{ id: 'one', sql: 'one.sql' }] }));
            await writeFile(join(plain, 'one.sql'), 'SELECT 1');

            return open(name);

        }

        it('should migrate a database without tracking tables before running', async () => {

            const fresh = await openFreshDatabase('run-unmigrated');

            const result = await fresh.noorm.pipelines.run('plain');
            if (result.dryRun) throw new Error('Expected an admitted run');

            expect(result.status).toBe('success');

        });

        it('should reject a bad run ID or history limit without touching the schema', async () => {

            const fresh = await openFreshDatabase('invalid-arguments');

            await expect(fresh.noorm.pipelines.getRun(0)).rejects.toThrow('Pipeline run ID must be a positive safe integer');
            await expect(fresh.noorm.pipelines.history('plain', { limit: 101 })).rejects.toThrow('Pipeline history limit');
            expect(await tablesExist(fresh.kysely, 'sqlite')).toBe(false);

        });

        it('should refuse every pipeline call on a database newer than this CLI', async () => {

            const newer = await openFreshDatabase('newer');
            await bootstrapSchema(newer.kysely, 'sqlite');
            await sql`UPDATE __noorm_version__ SET noorm_version = 999`.execute(newer.kysely);

            await expect(newer.noorm.pipelines.run('plain')).rejects.toThrow(VersionMismatchError);
            await expect(newer.noorm.pipelines.history('plain', {})).rejects.toThrow(VersionMismatchError);
            await expect(newer.noorm.pipelines.getRun(1)).rejects.toThrow(VersionMismatchError);

        });

        it('should refuse to read history from older tracking tables instead of migrating them', async () => {

            const older = await openFreshDatabase('older');
            await bootstrapSchema(older.kysely, 'sqlite');
            const stored = CURRENT_VERSIONS.schema - 1;
            await sql`UPDATE __noorm_version__ SET noorm_version = ${stored}`.execute(older.kysely);
            const needsMigration = `tracking tables are at schema version ${stored} and this version needs ${CURRENT_VERSIONS.schema}`;

            await expect(older.noorm.pipelines.history('plain', {})).rejects.toThrow(needsMigration);
            await expect(older.noorm.pipelines.getRun(1)).rejects.toThrow(needsMigration);

            const versions = await sql<{ noorm_version: number }>`SELECT noorm_version FROM __noorm_version__`.execute(older.kysely);
            expect(versions.rows).toEqual([{ noorm_version: stored }]);

        });

        it('requires a connection and enforces viewer, confirmation and agent policy even for dry runs', async () => {

            const disconnected = await createContext<NoormDatabase>({ projectRoot: root, config: 'alpha' });
            contexts.push(disconnected);
            await expect(disconnected.noorm.pipelines.run('refresh', { input: { name: 'x' } })).rejects.toThrow();
            await expect(disconnected.noorm.pipelines.history('refresh', {})).rejects.toThrow();
            await expect(disconnected.noorm.pipelines.getRun(1)).rejects.toThrow();
            const viewer = await open('viewer');
            const operator = await open('operator');
            const agent = await open('operator', { channel: 'agent', yes: true });
            for (const restricted of [viewer, operator, agent]) {

                await expect(restricted.noorm.pipelines.run('refresh', { input: { name: 'x' } })).rejects.toThrow();
                await expect(restricted.noorm.pipelines.run('refresh', { input: { name: 'x' }, dryRun: true })).rejects.toThrow();

            }
            expect(await markers()).toEqual([]);
            expect(await ctx.noorm.pipelines.history('refresh', {})).toEqual([]);
            const confirmed = await open('operator', { yes: true });
            const result = await confirmed.noorm.pipelines.run('refresh', { input: { name: 'confirmed' } });
            expect(result.status).toBe('success');
            expect(await markers()).toEqual([
                { name: 'confirmed', count: 7, enabled: 1 }, { name: 'confirmed', count: 7, enabled: 1 },
            ]);

        });

    });

}
