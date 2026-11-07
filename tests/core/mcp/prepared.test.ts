import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';

import { prepareCommand } from '../../../src/mcp/prepared.js';
import { Context } from '../../../src/sdk/context.js';
import { parseConfig } from '../../../src/core/config/schema.js';
import { parseSettings } from '../../../src/core/settings/schema.js';
import { generateKeyPair, setKeyOverride, clearKeyOverride } from '../../../src/core/identity/index.js';
import { initState, resetStateManager } from '../../../src/core/state/index.js';
import { resetLockManager } from '../../../src/core/lock/index.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';

describe('MCP immutable approved execution', () => {

    let root: string;
    let ctx: Context;
    const tableNames = async () => (await sql<{ name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table'
    `.execute(ctx.kysely)).rows.map((row) => row.name);

    beforeEach(async () => {

        resetStateManager();
        resetLockManager();
        root = await mkdtemp(path.join(tmpdir(), 'noorm-approved-'));
        await mkdir(path.join(root, 'sql'));
        const pair = await generateKeyPair();
        setKeyOverride(pair.privateKey);
        await initState(root);
        ctx = new Context(parseConfig({
            name: 'test', type: 'local', isTest: true,
            access: { user: 'admin', agent: 'admin' },
            connection: { dialect: 'sqlite', database: ':memory:' },
        }), parseSettings({ paths: { sql: 'sql', changes: 'changes' } }),
        { name: 'Approval test', source: 'system' }, { channel: 'agent' }, root);
        await ctx.connect();
        await v1.up(ctx.kysely, 'sqlite');

    });

    afterEach(async () => {

        await ctx?.disconnect();
        clearKeyOverride();
        resetStateManager();
        resetLockManager();
        await rm(root, { recursive: true, force: true });

    });

    it('executes captured rendered SQL rather than changed template content', async () => {

        const file = path.join(root, 'sql', 'one.sql.tmpl');
        await writeFile(file, 'CREATE TABLE reviewed (id INTEGER);');
        const prepared = await prepareCommand('run_file', { path: 'sql/one.sql.tmpl' }, ctx);
        await writeFile(file, 'CREATE TABLE substituted (id INTEGER);');
        const result = await prepared.run(() => ctx.noorm.run.file(file));
        expect(result.status).toBe('success');
        expect(await tableNames()).toContain('reviewed');
        expect(await tableNames()).not.toContain('substituted');

    });

    it('rejects newly discovered build files before executing the approved or added SQL', async () => {

        await writeFile(path.join(root, 'sql', '001.sql'), 'CREATE TABLE first (id INTEGER);');
        const prepared = await prepareCommand('run_build', {}, ctx);
        await writeFile(path.join(root, 'sql', '002.sql'), 'CREATE TABLE unapproved (id INTEGER);');
        await expect(prepared.run(() => ctx.noorm.run.build())).rejects.toThrow(/plan changed/);
        expect(await tableNames()).not.toContain('first');
        expect(await tableNames()).not.toContain('unapproved');

    });

    it('binds a fast-forward to the approved pending change set', async () => {

        const first = path.join(root, 'changes', '2026-01-01-first', 'change');
        await mkdir(first, { recursive: true });
        await writeFile(path.join(first, '001.sql'), 'CREATE TABLE first_change (id INTEGER);');
        const prepared = await prepareCommand('change_ff', {}, ctx);
        const extra = path.join(root, 'changes', '2026-01-02-extra', 'change');
        await mkdir(extra, { recursive: true });
        await writeFile(path.join(extra, '001.sql'), 'CREATE TABLE extra_change (id INTEGER);');
        await expect(prepared.run(() => ctx.noorm.changes.ff())).rejects.toThrow(/plan changed/);
        expect(await tableNames()).not.toContain('first_change');
        expect(await tableNames()).not.toContain('extra_change');

    });

    it('rejects an expanded change manifest before executing any referenced SQL', async () => {

        const name = '2026-01-01-manifest';
        const folder = path.join(root, 'changes', name, 'change');
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(root, 'sql', 'one.sql'), 'CREATE TABLE manifest_one (id INTEGER);');
        await writeFile(path.join(root, 'sql', 'two.sql'), 'CREATE TABLE manifest_two (id INTEGER);');
        const manifest = path.join(folder, '001.txt');
        await writeFile(manifest, 'one.sql\n');
        const prepared = await prepareCommand('change_run', { name }, ctx);
        await writeFile(manifest, 'one.sql\ntwo.sql\n');
        await expect(prepared.run(() => ctx.noorm.changes.apply(name))).rejects.toThrow(/plan changed/);
        expect(await tableNames()).not.toContain('manifest_one');
        expect(await tableNames()).not.toContain('manifest_two');

    });

    it('redacts known secrets in review but executes the original secret-bound snapshot', async () => {

        const state = await initState(root);
        await state.setConfig('test', ctx.noorm.config);
        await state.setSecret('test', 'KEY', 'first.secret');
        await state.setGlobalSecret('GLOBAL', 'global$secret');
        const file = path.join(root, 'sql', 'secret.sql.tmpl');
        await writeFile(file, "CREATE TABLE secret_value (local TEXT, global TEXT); INSERT INTO secret_value VALUES ('{%~ $.secrets.KEY %}', '{%~ $.globalSecrets.GLOBAL %}');");
        const prepared = await prepareCommand('run_file', { path: file }, ctx);
        expect(prepared.summary).not.toContain('first.secret');
        expect(prepared.summary).not.toContain('global$secret');
        expect(prepared.summary).toContain('[REDACTED SECRET]');
        await state.setSecret('test', 'KEY', 'second.secret');
        const changed = await prepareCommand('run_file', { path: file }, ctx);
        expect(changed.summary).toBe(prepared.summary);
        expect(changed.fingerprint).not.toBe(prepared.fingerprint);
        expect((await prepared.run(() => ctx.noorm.run.file(file))).status).toBe('success');
        expect((await sql`SELECT local, global FROM secret_value`.execute(ctx.kysely)).rows)
            .toEqual([{ local: 'first.secret', global: 'global$secret' }]);

    });

});
