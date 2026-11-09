import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql, type RawBuilder } from 'kysely';

import { createConnection } from '../../../src/core/connection/factory.js';
import { admitPipelineRun } from '../../../src/core/pipeline/admission.js';
import type { NoormDatabase } from '../../../src/core/shared/tables.js';
import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import { CLI, TMP_BASE, cleanupProject, extractJsonObject, runCli, setupProject, type TestProject } from '../run/_setup.js';
const secret = 'private-value-9327';
const rendered = 'INSERT INTO marker';

async function query<T>(project: TestProject, statement: RawBuilder<T>): Promise<T[]> {

    const connection = await createConnection({ dialect: 'sqlite', database: project.dbPath }, '__test__');
    try {

        return (await statement.execute(connection.db)).rows;

    }
    finally {

        await connection.destroy();

    }

}

async function pipeline(project: TestProject, slug: string, manifest: object, files: Record<string, string>) {

    const folder = join(project.dir, 'db', 'pipelines', slug);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify(manifest));
    for (const [name, content] of Object.entries(files)) await writeFile(join(folder, name), content);

    return folder;

}

function envelope(stdout: string): Record<string, unknown> & { success?: unknown; error?: unknown } {

    const text = extractJsonObject(stdout);
    expect(text).not.toBeNull();

    return JSON.parse(text!) as Record<string, unknown>;

}

function privateOutput(output: string, folder?: string) {

    expect(output).not.toContain(secret);
    expect(output).not.toContain(rendered);
    if (folder) expect(output).not.toContain(folder);

}

const inputs = {
    title: { type: 'string', description: 'Title to record', required: true },
    itemCount: { type: 'integer', description: 'Number of items', default: 7 },
    enabled: { type: 'boolean', description: 'Whether enabled', default: true },
    mode: { type: 'string', description: 'Processing mode', default: 'fast', choices: ['fast', 'slow'] },
};
const insert = 'INSERT INTO marker (title, count, enabled, mode) VALUES ({%~ $.quote($.input.title) %}, {%~ $.input.itemCount %}, {%~ $.input.enabled ? 1 : 0 %}, {%~ $.quote($.input.mode) %})';

describe('cli: actual pipeline commands', () => {

    let project: TestProject;

    beforeEach(async () => {

        project = await setupProject();
        await query(project, sql`CREATE TABLE marker (title TEXT, count INTEGER, enabled INTEGER, mode TEXT)`);
        await pipeline(project, 'refresh', {
            inputs, steps: [{ id: 'first', sql: 'insert.sql.tmpl' }, { id: 'again', sql: 'insert.sql.tmpl' }],
        }, { 'insert.sql.tmpl': insert });

    });

    afterEach(async () => {

        await cleanupProject(project);

    });

    for (const slug of ['history', 'show', 'run']) {

        it(`executes and reads history for a workflow named ${slug}`, async () => {

            await pipeline(project, slug, { steps: [{ id: 'marker', sql: 'marker.sql' }] }, {
                'marker.sql': `INSERT INTO marker (title) VALUES ('${slug}')`,
            });
            const result = runCli(project, ['pipeline', 'run', slug, '--json', '--yes']);
            expect(result.status).toBe(0);
            expect(envelope(result.stdout)).toMatchObject({ success: true, slug });
            const history = runCli(project, ['pipeline', 'history', slug, '--json']);
            expect(history.status).toBe(0);
            expect(history.stdout).toContain(slug);
            expect(await query(project, sql`SELECT title FROM marker`)).toEqual([{ title: slug }]);
            expect(await query(project, sql`SELECT slug FROM __noorm_pipeline_run__`)).toEqual([{ slug }]);

        });

    }

    for (const configFlag of ['--config', '-c']) {

        it(`executes with ${configFlag}, boolean switches and generated values before the slug`, async () => {

            const { privateKey } = generateKeyPair();
            const state = new StateManager(project.dir, { privateKey });
            await state.load();
            await state.setConfig('__test__', {
                name: '__test__', type: 'local', isTest: true,
                access: { user: 'admin', agent: 'admin' },
                connection: { dialect: 'sqlite', database: project.dbPath },
            });
            const configured = { ...project, env: {
                ...project.env, NOORM_IDENTITY_PRIVATE_KEY: privateKey,
                NOORM_IDENTITY_NAME: 'Pipeline tester', NOORM_IDENTITY_EMAIL: 'pipeline@example.com',
            } };
            const flags = ['--json', configFlag, '__test__', '-y', '-f',
                '--title', secret, '--enabled', 'false', '--item-count', '0'];
            const dryRun = runCli(configured, ['pipeline', 'run', '--dry-run', ...flags, 'refresh']);
            expect(dryRun.status).toBe(0);
            expect(envelope(dryRun.stdout)).toMatchObject({ success: true, dryRun: true, slug: 'refresh' });
            expect(await query(project, sql`SELECT * FROM marker`)).toEqual([]);
            expect(await query(project, sql`SELECT * FROM __noorm_pipeline_run__`)).toEqual([]);
            const result = runCli(configured, ['pipeline', 'run', ...flags, 'refresh']);
            expect(result.status).toBe(0);
            expect(envelope(result.stdout)).toMatchObject({ success: true, slug: 'refresh' });
            privateOutput(dryRun.stdout + dryRun.stderr + result.stdout + result.stderr);
            expect(await query(project, sql`SELECT title, count, enabled FROM marker ORDER BY rowid`)).toEqual([
                { title: secret, count: 0, enabled: 0 }, { title: secret, count: 0, enabled: 0 },
            ]);
            expect(await query(project, sql`SELECT slug, config_name FROM __noorm_pipeline_run__`)).toEqual([
                { slug: 'refresh', config_name: '__test__' },
            ]);

        });

    }

    it('executes fresh typed invocations, scopes history and show, and keeps output private', async () => {

        const first = spawnSync('node', [CLI, '--cwd', project.dir, 'pipeline', 'run', 'refresh', '--input', JSON.stringify({ title: secret, itemCount: 9, enabled: true }), '--item-count', '0', '--enabled=false', '--mode', 'slow', '--json', '--yes'], {
            cwd: TMP_BASE, encoding: 'utf-8', env: { ...process.env, ...project.env },
        });
        expect(first.status).toBe(0);
        expect(envelope(first.stdout).success).toBe(true);
        privateOutput(first.stdout + first.stderr);
        const second = runCli(project, ['pipeline', 'run', 'refresh', '--title', 'second', '--json', '--yes']);
        expect(second.status).toBe(0);
        expect(envelope(second.stdout).success).toBe(true);
        expect(await query(project, sql`SELECT title, count, enabled, mode FROM marker ORDER BY rowid`)).toEqual([
            { title: secret, count: 0, enabled: 0, mode: 'slow' }, { title: secret, count: 0, enabled: 0, mode: 'slow' },
            { title: 'second', count: 7, enabled: 1, mode: 'fast' }, { title: 'second', count: 7, enabled: 1, mode: 'fast' },
        ]);
        const rows = await query<{ id: number; config_name: string }>(project, sql`SELECT id, config_name FROM __noorm_pipeline_run__ ORDER BY id`);
        expect(rows).toHaveLength(2);
        expect(rows[0]!.id).not.toBe(rows[1]!.id);
        expect(rows.map((row) => row.config_name)).toEqual(['__test__', '__test__']);
        const history = runCli(project, ['pipeline', 'history', 'refresh', '--json', '--limit', '2']);
        expect(history.status).toBe(0);
        expect(envelope(history.stdout).success).toBe(true);
        const historyText = JSON.stringify(envelope(history.stdout));
        expect(historyText.indexOf(String(rows[1]!.id))).toBeLessThan(historyText.indexOf(String(rows[0]!.id)));
        const show = runCli(project, ['pipeline', 'show', String(rows[0]!.id), '--json']);
        expect(show.status).toBe(0);
        expect(envelope(show.stdout).success).toBe(true);
        expect(show.stdout).toContain('first');
        expect(show.stdout).toContain('again');
        privateOutput(history.stdout + history.stderr + show.stdout + show.stderr);
        const other = { ...project, env: { ...project.env, NOORM_NAME: 'other-config' } };
        const foreignHistory = runCli(other, ['pipeline', 'history', 'refresh', '--json']);
        expect(foreignHistory.status).toBe(0);
        expect(JSON.stringify(envelope(foreignHistory.stdout))).not.toContain('refresh');
        const foreignShow = runCli(other, ['pipeline', 'show', String(rows[0]!.id), '--json']);
        expect(foreignShow.status).not.toBe(0);
        expect(envelope(foreignShow.stdout).success).toBe(false);

    }, 20_000);

    it('should report a missing run as not found', async () => {

        const absent = runCli(project, ['pipeline', 'show', '999', '--json']);
        expect(absent.status).toBe(1);
        expect(absent.stdout + absent.stderr).toContain('Pipeline run not found');

    });

    it('should report a failing history read as an error, not as not found', async () => {

        expect(runCli(project, ['pipeline', 'run', 'refresh', '--title', 'x', '--json', '--yes']).status).toBe(0);
        await query(project, sql`DROP TABLE __noorm_pipeline_step__`);
        await query(project, sql`CREATE VIEW __noorm_pipeline_step__ AS SELECT * FROM missing_table`);
        const broken = runCli(project, ['pipeline', 'show', '1', '--json']);
        expect(broken.status).toBe(1);
        expect(envelope(broken.stdout)).toMatchObject({ success: false, error: expect.any(String) });
        expect(broken.stdout + broken.stderr).not.toContain('Pipeline run not found');

    });

    it('should name the failed definition rule with exit 2 and no project path', async () => {

        await pipeline(project, 'broken', { steps: [{ id: 'gone', sql: 'absent.sql' }] }, {});
        const result = runCli(project, ['pipeline', 'run', 'broken', '--json', '--yes']);
        expect(result.status).toBe(2);
        expect(result.stdout + result.stderr).toContain('missing-file');
        expect(result.stdout + result.stderr).not.toContain(project.dir);

    });

    it('should report an unknown pipeline as not found with exit 2', async () => {

        const result = runCli(project, ['pipeline', 'run', 'typo', '--json', '--yes']);
        expect(result.status).toBe(2);
        expect(result.stdout + result.stderr).toContain('Pipeline not found');
        expect(result.stdout + result.stderr).not.toContain('missing-file');

    });

    async function configured(access: 'operator' | 'viewer') {

        const { privateKey } = generateKeyPair();
        const state = new StateManager(project.dir, { privateKey });
        await state.load();
        await state.setConfig('__test__', {
            name: '__test__', type: 'local', isTest: true,
            access: { user: access, agent: access },
            connection: { dialect: 'sqlite', database: project.dbPath },
        });

        return { ...project, env: {
            ...project.env, NOORM_IDENTITY_PRIVATE_KEY: privateKey,
            NOORM_IDENTITY_NAME: 'Pipeline tester', NOORM_IDENTITY_EMAIL: 'pipeline@example.com',
        } };

    }

    it('should block a run that needs confirmation when --yes is absent', async () => {

        const result = runCli(await configured('operator'), ['pipeline', 'run', 'refresh', '--title', 'x', '--json', '-c', '__test__']);
        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain('blocked by the config policy or requires confirmation; pass --yes');
        expect(await query(project, sql`SELECT * FROM marker`)).toEqual([]);
        expect(await query(project, sql`SELECT * FROM __noorm_pipeline_run__`)).toEqual([]);

    });

    it('should report a policy block without asking for --yes when --yes was given', async () => {

        const result = runCli(await configured('viewer'), ['pipeline', 'run', 'refresh', '--title', 'x', '--json', '--yes', '-c', '__test__']);
        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain('Pipeline execution is blocked by the config policy');
        expect(result.stdout + result.stderr).not.toContain('pass --yes');
        expect(await query(project, sql`SELECT * FROM marker`)).toEqual([]);
        expect(await query(project, sql`SELECT * FROM __noorm_pipeline_run__`)).toEqual([]);

    });

    it('should refuse a single-run pipeline whose guard is held', async () => {

        await pipeline(project, 'solo', { singleRun: true, steps: [{ id: 'one', sql: 'one.sql' }] }, {
            'one.sql': "INSERT INTO marker (title) VALUES ('solo')",
        });
        const connection = await createConnection({ dialect: 'sqlite', database: project.dbPath }, '__test__');
        try {

            await admitPipelineRun(
                { db: connection.db.withTables<Pick<NoormDatabase, keyof NoormDatabase>>(), dialect: 'sqlite', configName: '__test__', executedBy: 'tester', cliVersion: 'test' },
                { slug: 'solo', manifestChecksum: 'a'.repeat(64), transaction: 'step', singleRun: true,
                    steps: [{ stepNo: 1, name: 'one', filepath: 'one.sql', checksum: 'b'.repeat(64), needs: [] }] },
            );

        }
        finally {

            await connection.destroy();

        }
        const result = runCli(project, ['pipeline', 'run', 'solo', '--json', '--yes']);
        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain('Pipeline execution was not admitted');
        expect(await query(project, sql`SELECT * FROM marker`)).toEqual([]);
        expect(await query(project, sql`SELECT slug FROM __noorm_pipeline_run__`)).toEqual([{ slug: 'solo' }]);

    });

    it('prepares a dry run without markers or history', async () => {

        const result = runCli(project, ['pipeline', 'run', 'refresh', '--title', secret, '--dry-run', '--json', '--yes']);
        expect(result.status).toBe(0);
        expect(envelope(result.stdout).success).toBe(true);
        privateOutput(result.stdout + result.stderr);
        expect(await query(project, sql`SELECT * FROM marker`)).toEqual([]);
        expect(await query(project, sql`SELECT * FROM __noorm_pipeline_run__`)).toEqual([]);
        expect(await query(project, sql`SELECT * FROM __noorm_pipeline_step__`)).toEqual([]);

    });

    it('reports successful unmanaged SQL with unknown provenance as CLI failure', async () => {

        const folder = await pipeline(project, 'unmanaged', {
            transaction: 'none', inputs, steps: [{ id: 'manual', sql: 'manual.sql.tmpl' }],
        }, { 'manual.sql.tmpl': `BEGIN; ${insert}; COMMIT;` });
        const result = runCli(project, ['pipeline', 'run', 'unmanaged', '--title', secret, '--json', '--yes']);
        expect(result.status).toBe(1);
        expect(envelope(result.stdout)).toMatchObject({
            success: false, status: 'success', transactionOutcome: 'unknown',
            steps: [{ name: 'manual', status: 'success', transactionOutcome: 'unknown' }],
        });
        privateOutput(result.stdout + result.stderr, folder);
        expect(await query(project, sql`SELECT title FROM marker`)).toEqual([{ title: secret }]);
        expect(await query(project, sql`SELECT status, transaction_outcome FROM __noorm_pipeline_run__`)).toEqual([
            { status: 'success', transaction_outcome: 'unknown' },
        ]);

    });

    for (const json of [true, false]) {

        it(`reports all missing required inputs safely in ${json ? 'JSON' : 'noninteractive text'}`, async () => {

            const folder = await pipeline(project, 'required', {
                inputs: {
                    period: { type: 'string', description: 'Period', required: true },
                    tenant: { type: 'string', description: 'Tenant', required: true },
                    credential: { type: 'string', description: 'Optional credential' },
                },
                steps: [{ id: 'unused', sql: 'unused.sql' }],
            }, { 'unused.sql': 'SELECT 1' });
            const result = runCli(project, ['pipeline', 'run', 'required', '--credential', secret, ...(json ? ['--json'] : [])]);
            expect(result.status).toBe(2);
            const output = result.stdout + result.stderr;
            if (json) {

                expect(envelope(result.stdout)).toMatchObject({
                    success: false, error: 'Missing required pipeline inputs: period, tenant',
                });

            }
            else expect(output).toContain('Missing required pipeline inputs: period, tenant');
            privateOutput(output, folder);
            expect(await query(project, sql`SELECT * FROM marker`)).toEqual([]);
            expect(await query(project, sql`SELECT * FROM __noorm_pipeline_run__`)).toEqual([]);

        });

    }

    for (const [policy, status, expected] of [
        ['pipeline', 1, []], ['step', 3, ['first']],
    ] as const) {

        it(`reports ${policy} failure with truthful committed markers and exit ${status}`, async () => {

            await pipeline(project, 'broken', { transaction: policy, steps: [
                { id: 'first', sql: 'first.sql' }, { id: 'bad', sql: 'bad.sql' }, { id: 'last', sql: 'last.sql' },
            ] }, {
                'first.sql': "INSERT INTO marker (title) VALUES ('first')",
                'bad.sql': 'INSERT INTO nonexistent_pipeline_table VALUES (1)',
                'last.sql': "INSERT INTO marker (title) VALUES ('last')",
            });
            const result = runCli(project, ['pipeline', 'run', 'broken', '--json', '--yes']);
            expect(result.status).toBe(status);
            expect(envelope(result.stdout).success).toBe(false);
            expect((await query<{ title: string }>(
                project, sql`SELECT title FROM marker ORDER BY rowid`,
            )).map((r) => r.title)).toEqual([...expected]);
            expect(await query(project, sql`SELECT name, status FROM __noorm_pipeline_step__ ORDER BY step_no`)).toEqual([
                { name: 'first', status: 'success' }, { name: 'bad', status: 'failed' }, { name: 'last', status: 'skipped' },
            ]);

        });

    }

    it('rejects invalid definition, inputs and invocations before admitting a run', async () => {

        await pipeline(project, 'invalid', { steps: [] }, {});
        const cases = [
            ['pipeline'],
            ['pipeline', 'run'],
            ['pipeline', 'unknown-verb'],
            ['pipeline', 'refresh', '--title', secret],
            ['pipeline', 'run', 'invalid'],
            ['pipeline', 'run', 'refresh', '--title', secret, '--item-count', 'not-an-integer'],
            ['pipeline', 'run', 'refresh', '--input', '{bad'],
            ['pipeline', 'run', 'refresh', '--title', secret, '--unknown-generated-flag', 'x'],
            ['pipeline', 'run', 'refresh', 'extra', '--title', secret],
            ['pipeline', 'run', '--json', '--title', secret, '--unknown-generated-flag', 'x', 'refresh'],
            ['pipeline', 'run', '--title', secret, '--item-count', 'not-an-integer', 'refresh'],
            ['pipeline', 'run', '--title', secret, '--enabled', 'not-a-boolean', 'refresh'],
            ['pipeline', 'run', '--title', secret, 'refresh', 'extra'],
            ['pipeline', 'run', '--json', '--yes'],
            ['pipeline', 'run', '--title', secret, '--__proto__', 'x', 'refresh'],
            ['pipeline', 'history', 'refresh', 'extra'],
            ['pipeline', 'history', 'refresh', '--limit', '0'],
            ['pipeline', 'show', '0'],
        ];
        for (const args of cases) {

            const result = runCli(project, [...args, '--json', '--yes']);
            expect({ args, status: result.status }).toEqual({ args, status: 2 });
            const payload = envelope(result.stdout);
            expect(payload.success).toBe(false);
            expect(typeof payload.error).toBe('string');
            privateOutput(result.stdout + result.stderr);

        }
        expect(await query(project, sql`SELECT * FROM marker`)).toEqual([]);
        expect(await query(project, sql`SELECT * FROM __noorm_pipeline_run__`)).toEqual([]);

    }, 20_000);

    it('sanitizes template errors, including absolute paths and input', async () => {

        const folder = await pipeline(project, 'throwing', {
            inputs, steps: [{ id: 'bad', sql: 'throw.sql.tmpl' }],
        }, { 'throw.sql.tmpl': `{% throw new Error($.input.title + ' ${secret}'); %}` });
        const result = runCli(project, ['pipeline', 'run', 'throwing', '--title', secret, '--json', '--yes']);
        expect(result.status).toBe(2);
        expect(envelope(result.stdout).success).toBe(false);
        privateOutput(result.stdout + result.stderr, folder);
        expect(await query(project, sql`SELECT * FROM __noorm_pipeline_run__`)).toEqual([]);

    });

    it('completes commands without selecting a workflow inside or outside a project', async () => {

        await pipeline(project, 'pipeline', { steps: [] }, {});
        await pipeline(project, 'run', { steps: [] }, {});
        for (const cwd of [project.dir, TMP_BASE]) {

            for (const { words, expected } of [
                { words: ['pipeline', ''], expected: ['run', 'history', 'show'] },
                { words: ['pipeline', 'r'], expected: ['run'] },
                { words: ['run', ''], expected: ['build', 'dir', 'file'] },
            ]) {

                const result = spawnSync('node', [CLI, '--cwd', cwd, 'complete', '--', ...words], {
                    cwd: TMP_BASE, encoding: 'utf-8', env: { ...process.env, ...project.env },
                });
                expect({ cwd, words, status: result.status }).toEqual({ cwd, words, status: 0 });
                const lines = result.stdout.trim().split('\n');
                expect(lines.at(-1)).toMatch(/^:\d+$/);
                expect(lines.map((line) => line.split('\t')[0])).toEqual(expect.arrayContaining(expected));
                privateOutput(result.stdout + result.stderr);

            }

        }
        expect(await query(project, sql`SELECT * FROM marker`)).toEqual([]);
        expect(await query(project, sql`SELECT * FROM __noorm_pipeline_run__`)).toEqual([]);

    }, 20_000);

    it('renders slug help offline without connecting, rendering or writing; root help ignores invalid manifests', async () => {

        const folder = await pipeline(project, 'offline', {
            description: 'Offline sample workflow', inputs, steps: [{ id: 'bad', sql: 'throw.sql.tmpl' }],
        }, { 'throw.sql.tmpl': `{% throw new Error('${secret}'); %}` });
        await pipeline(project, 'invalid', { steps: [] }, {});
        const offline = { ...project, env: { ...project.env, NOORM_CONNECTION_DATABASE: join(project.dir, 'missing', 'cannot-open.db'), NOORM_IDENTITY_PRIVATE_KEY: 'invalid-key', NOORM_SECRET_BROKEN: 'invalid-secret' } };
        for (const flags of [
            ['offline', '--help'],
            ['--json', '--config', 'unavailable', '--dry-run', '--yes', 'offline', '--help'],
            ['-c', 'unavailable', '-y', '-f', '--title', secret, '--enabled', 'false', '--item-count', '0', 'offline', '-h'],
            ['--input', JSON.stringify({ title: secret }), 'offline', '--help'],
        ]) {

            const help = runCli(offline, ['--cwd', project.dir, 'pipeline', 'run', ...flags]);
            expect(help.status).toBe(0);
            const text = help.stdout + help.stderr;
            for (const expected of ['Offline sample workflow', 'Title to record', 'string', 'required', 'Number of items', 'integer', '7', 'Processing mode', 'fast', 'slow']) {

                expect(text.toLowerCase()).toContain(expected.toLowerCase());

            }
            privateOutput(text, folder);
            expect(text).toMatch(/pipeline run.*<slug>/i);
            expect(text).not.toContain('run run');

        }
        await pipeline(project, 'run', { steps: [] }, {});
        for (const args of [
            ['pipeline', '--help'], ['pipeline', 'run', '--help'],
            ['pipeline', 'run', '--config', 'unavailable', '--json', '--dry-run', '-y', '--help'],
        ]) {

            for (const cwd of [project.dir, TMP_BASE]) {

                const generic = runCli(offline, ['--cwd', cwd, ...args]);
                expect(generic.status).toBe(0);
                const output = generic.stdout + generic.stderr;
                expect(output).toContain('run');
                if (args.length === 2) {

                    expect(output).toContain('history');
                    expect(output).toContain('show');

                }
                else expect(output.toLowerCase()).toContain('<slug>');
                expect(output).not.toContain('Title to record');
                privateOutput(output);

            }

        }
        const root = runCli(offline, ['--help']);
        expect(root.status).toBe(0);
        expect(root.stdout + root.stderr).not.toContain(secret);
        expect(existsSync(join(project.dir, 'missing', 'cannot-open.db'))).toBe(false);
        expect(await query(project, sql`SELECT * FROM marker`)).toEqual([]);
        expect(await query(project, sql`SELECT * FROM __noorm_pipeline_run__`)).toEqual([]);

    }, 20_000);

});
