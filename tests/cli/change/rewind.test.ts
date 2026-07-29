/**
 * cli: noorm change rewind — flag plumbing and the documented count form.
 *
 * Mirrors tests/cli/change/history.test.ts's harness (subprocess against
 * the compiled CLI, identity via NOORM_IDENTITY_*, config seeded through
 * StateManager). Driven end to end against a real sqlite file because the
 * defects here are invisible to the result payload: rewind reported
 * `status: "success"` both when `--dry-run` dropped a live table and when
 * the count form matched nothing. The database is the only honest oracle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Database } from 'bun:sqlite';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import type { Config } from '../../../src/core/config/types.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const CONFIG_NAME = 'changerewind';

/** Strips inherited NOORM_* env vars before applying explicit overrides, so no ambient NOORM_YES/NOORM_CONFIG leaks into a subprocess run. */
function cleanEnvWithOverrides(overrides: Record<string, string | undefined>): Record<string, string> {

    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {

        if (value !== undefined && !key.startsWith('NOORM_')) env[key] = value;

    }

    for (const [key, value] of Object.entries(overrides)) {

        if (value !== undefined) env[key] = value;

    }

    return env;

}

describe('cli: noorm change rewind', () => {

    let tmpDir: string;
    let fakeHome: string;
    let dbPath: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-change-rewind-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-change-rewind-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(
            join(tmpDir, '.noorm', 'settings.yml'),
            'paths:\n    sql: ./sql\n    changes: ./changes\n',
        );
        mkdirSync(join(tmpDir, 'sql'), { recursive: true });

        dbPath = join(tmpDir, 'target.db');
        writeFileSync(dbPath, '');

        privateKey = generateKeyPair().privateKey;
        identityEnv = cleanEnvWithOverrides({
            HOME: fakeHome,
            NOORM_IDENTITY_PRIVATE_KEY: privateKey,
            NOORM_IDENTITY_NAME: 'CI Bot',
            NOORM_IDENTITY_EMAIL: 'ci@example.com',
        });

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });

    });

    /** Writes a real encrypted state.enc with one active admin-role config, bypassing the TUI-only `config add`/`edit` commands. */
    async function seedConfig(): Promise<void> {

        const config: Config = {
            name: CONFIG_NAME,
            type: 'local',
            isTest: true,
            access: { user: 'admin', mcp: 'admin' },
            connection: { dialect: 'sqlite', database: dbPath },
        };

        const manager = new StateManager(tmpDir, { privateKey });
        await manager.load();
        await manager.setConfig(CONFIG_NAME, config);
        await manager.setActiveConfig(CONFIG_NAME);

    }

    function seedChange(name: string, table: string): void {

        const base = join(tmpDir, 'changes', name);

        mkdirSync(join(base, 'change'), { recursive: true });
        mkdirSync(join(base, 'revert'), { recursive: true });

        writeFileSync(
            join(base, 'change', '001_create.sql'),
            `CREATE TABLE ${table} (id INTEGER PRIMARY KEY)`,
        );
        writeFileSync(join(base, 'revert', '001_drop.sql'), `DROP TABLE ${table}`);

    }

    function runCli(args: string[]) {

        return spawnSync('node', [CLI, 'change', ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: identityEnv,
        });

    }

    function tableExists(table: string): boolean {

        const db = new Database(dbPath, { readonly: true });
        const row = db
            .query('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = ?')
            .get(table);

        db.close();

        return row !== null;

    }

    it('--dry-run must not execute the reverts', async () => {

        await seedConfig();
        seedChange('2026-03-01-probe', 'rewind_probe');

        expect(runCli(['run', '2026-03-01-probe', '--json']).status).toBe(0);
        expect(tableExists('rewind_probe')).toBe(true);

        const result = runCli(['rewind', '2026-03-01-probe', '--dry-run', '--json']);

        expect(result.status).toBe(0);

        // The whole contract of --dry-run: the database is untouched.
        expect(tableExists('rewind_probe')).toBe(true);

    });

    it('reverts the last N applied changes when given a count', async () => {

        await seedConfig();
        seedChange('2026-03-01-first', 'rewind_first');
        seedChange('2026-03-02-second', 'rewind_second');

        expect(runCli(['ff', '--json']).status).toBe(0);
        expect(tableExists('rewind_first')).toBe(true);
        expect(tableExists('rewind_second')).toBe(true);

        // The form documented in docs/guide/changes/forward-revert.md.
        const result = runCli(['rewind', '1', '--json']);

        expect(result.status).toBe(0);
        expect(tableExists('rewind_second')).toBe(false);
        expect(tableExists('rewind_first')).toBe(true);

    });

    it('marks a change deleted from disk as orphaned in list output', async () => {

        await seedConfig();
        seedChange('2026-03-01-probe', 'rewind_probe');

        expect(runCli(['run', '2026-03-01-probe', '--json']).status).toBe(0);

        rmSync(join(tmpDir, 'changes', '2026-03-01-probe'), { recursive: true, force: true });

        const result = runCli(['list']);

        expect(result.status).toBe(0);

        // Without the marker this prints identically to a live applied change.
        expect(result.stdout).toContain('orphaned');

    });

    it('reports why a rewind target that matches nothing failed', async () => {

        await seedConfig();
        seedChange('2026-03-01-probe', 'rewind_probe');

        expect(runCli(['run', '2026-03-01-probe', '--json']).status).toBe(0);

        const result = runCli(['rewind', 'no-such-change', '--json']);

        expect(result.status).not.toBe(0);

        const parsed = JSON.parse(result.stdout);

        expect(parsed.status).toBe('failed');
        expect(parsed.error).toBeTruthy();
        expect(parsed.error).toContain('no-such-change');

    });

});
