import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';

import { prepareCommand, resolveProjectFile } from '../../../src/mcp/prepared.js';
import { Context } from '../../../src/sdk/context.js';
import { parseConfig } from '../../../src/core/config/schema.js';
import { parseSettings } from '../../../src/core/settings/schema.js';
import { generateKeyPair, setKeyOverride, clearKeyOverride } from '../../../src/core/identity/index.js';
import { initState, resetStateManager } from '../../../src/core/state/index.js';
import { resetLockManager } from '../../../src/core/lock/index.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';

describe('mcp: immutable approved execution', () => {

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

    it('should keep the project root alias after checking the canonical target', async () => {

        const alias = path.join(root, 'project-link');
        await symlink(root, alias, 'dir');
        await writeFile(path.join(root, 'sql', 'one.sql'), 'SELECT 1;');
        expect(await resolveProjectFile(alias, 'sql/one.sql')).toBe(path.join(alias, 'sql', 'one.sql'));

    });

    it('should execute captured SQL rather than changed file content', async () => {

        const file = path.join(root, 'sql', 'one.sql');
        await writeFile(file, 'CREATE TABLE reviewed (id INTEGER);');
        const prepared = await prepareCommand('run_file', { path: 'sql/one.sql' }, ctx);
        await writeFile(file, 'CREATE TABLE substituted (id INTEGER);');
        const result = await prepared.run(() => ctx.noorm.run.file(file));
        expect(result.status).toBe('success');
        expect(await tableNames()).toContain('reviewed');
        expect(await tableNames()).not.toContain('substituted');

    });

    for (const viaManifest of [false, true]) {

        it(`should share checksums between approved and ordinary SQL changes${viaManifest ? ' through a manifest' : ''}`, async () => {

            const name = viaManifest ? '2026-01-01-manifest' : '2026-01-01-direct';
            const folder = path.join(root, 'changes', name, 'change');
            await mkdir(folder, { recursive: true });
            const file = viaManifest ? path.join(root, 'sql', 'approved.sql') : path.join(folder, '001.sql');
            const source = 'CREATE TABLE approved_change (id INTEGER);';
            await writeFile(file, source);
            if (viaManifest) await writeFile(path.join(folder, '001.txt'), 'approved.sql\n');
            const prepared = await prepareCommand('change_run', { name }, ctx);
            await writeFile(file, 'CREATE TABLE substituted_change (id INTEGER);');
            expect((await prepared.run(() => ctx.noorm.changes.apply(name))).status).toBe('success');
            expect(await tableNames()).toContain('approved_change');
            expect(await tableNames()).not.toContain('substituted_change');
            await writeFile(file, source);
            expect((await ctx.noorm.changes.apply(name)).files).toEqual([]);

        });

    }
    it('should reject newly discovered build files before executing the approved or added SQL', async () => {

        await writeFile(path.join(root, 'sql', '001.sql'), 'CREATE TABLE first (id INTEGER);');
        const prepared = await prepareCommand('run_build', {}, ctx);
        await writeFile(path.join(root, 'sql', '002.sql'), 'CREATE TABLE unapproved (id INTEGER);');
        await expect(prepared.run(() => ctx.noorm.run.build())).rejects.toThrow(/plan changed/);
        expect(await tableNames()).not.toContain('first');
        expect(await tableNames()).not.toContain('unapproved');

    });

    it('should bind a fast-forward to the approved pending change set', async () => {

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

    it('should permit a plain pending fast-forward after a previously applied template', async () => {

        const appliedName = '2026-01-01-applied';
        const applied = path.join(root, 'changes', appliedName, 'change');
        await mkdir(applied, { recursive: true });
        await writeFile(path.join(applied, '001.sql.tmpl'), 'CREATE TABLE previous_change (id INTEGER);');
        expect((await ctx.noorm.changes.apply(appliedName)).status).toBe('success');

        const pending = path.join(root, 'changes', '2026-01-02-pending', 'change');
        await mkdir(pending, { recursive: true });
        await writeFile(path.join(pending, '001.sql'), 'CREATE TABLE pending_change (id INTEGER);');
        const marker = path.join(root, 'helper-ran');
        await writeFile(path.join(applied, '$helpers.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran');`);
        const prepared = await prepareCommand('change_ff', {}, ctx);
        expect(prepared.summary).toContain('pending_change');
        expect(prepared.summary).not.toContain('previous_change');
        expect(existsSync(marker)).toBe(false);
        expect((await prepared.run(() => ctx.noorm.changes.ff())).status).toBe('success');
        expect(await tableNames()).toContain('pending_change');
        expect(existsSync(marker)).toBe(false);

    });

    it('should reject an expanded change manifest before executing any referenced SQL', async () => {

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

    it('should redact known secrets and connection credentials in review but retain original SQL', async () => {

        const state = await initState(root);
        await state.setConfig('test', ctx.noorm.config);
        await state.setSecret('test', 'KEY', 'first.secret');
        await state.setGlobalSecret('GLOBAL', 'global$secret');
        const config = parseConfig({
            name: 'test', type: 'local', isTest: true,
            access: { user: 'admin', agent: 'admin' },
            connection: { dialect: 'sqlite', database: ':memory:', password: 'db-password' },
        });
        const credentialCtx = new Context(config, parseSettings({}), { name: 'Approval test', source: 'system' }, { channel: 'agent' }, root);
        await credentialCtx.connect();
        try {

            const file = path.join(root, 'sql', 'secret.sql');
            await writeFile(file, "SELECT 'first.secret', 'global$secret', 'db-password';");
            const prepared = await prepareCommand('run_file', { path: file }, credentialCtx);
            expect(prepared.summary).not.toContain('first.secret');
            expect(prepared.summary).not.toContain('global$secret');
            expect(prepared.summary).not.toContain('db-password');
            expect(prepared.summary).toContain('[REDACTED SECRET]');
            expect(prepared.summary).toContain('best-effort');

        }
        finally {

            await credentialCtx.disconnect();

        }

    });

});
