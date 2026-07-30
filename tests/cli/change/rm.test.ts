/**
 * cli: noorm change rm — role gate + isYesMode confirm (v1-44 CP-3).
 *
 * Mirrors tests/cli/db/reset.test.ts harness: driven as a subprocess
 * against the compiled CLI (rm.ts calls process.exit, which would kill
 * an in-process test runner). Identity comes from NOORM_IDENTITY_* env
 * vars, and the config fixture is written directly via StateManager
 * since config add/edit are TUI-only and cannot set an exact access
 * role from the CLI.
 *
 * change rm is disk-only (no live DB connection needed), so the seeded
 * config connection points at a throwaway sqlite path that is never
 * opened by this command.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import type { Config } from '../../../src/core/config/types.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const CONFIG_NAME = 'rmgate';
const CHANGE_NAME = '2024-04-17-sample';

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

describe('cli: noorm change rm — role gate + isYesMode confirm', () => {

    let tmpDir: string;
    let fakeHome: string;
    let dbPath: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;
    let changePath: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-change-rm-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-change-rm-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(
            join(tmpDir, '.noorm', 'settings.yml'),
            'paths:\n    sql: ./sql\n    changes: ./changes\n',
        );

        dbPath = join(tmpDir, 'target.db');
        writeFileSync(dbPath, '');

        changePath = join(tmpDir, 'changes', CHANGE_NAME);
        mkdirSync(changePath, { recursive: true });

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

    /** Writes a real encrypted state.enc with one active config at the given access role, bypassing the TUI-only config add/edit commands. */
    async function seedConfig(access: ConfigAccess): Promise<void> {

        const config: Config = {
            name: CONFIG_NAME,
            type: 'local',
            isTest: true,
            access,
            connection: { dialect: 'sqlite', database: dbPath },
        };

        const manager = new StateManager(tmpDir, { privateKey });
        await manager.load();
        await manager.setConfig(CONFIG_NAME, config);
        await manager.setActiveConfig(CONFIG_NAME);

    }

    function runRm(args: string[] = [], envOverrides: Record<string, string | undefined> = {}) {

        return spawnSync('node', [CLI, 'change', 'rm', CHANGE_NAME, ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: { ...identityEnv, ...envOverrides },
        });

    }

    it('viewer-role active config denies deletion, disk untouched, even with --yes passed', async () => {

        await seedConfig({ user: 'viewer', agent: 'admin' });

        const result = runRm(['--yes']);

        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain('not allowed');
        expect(existsSync(changePath)).toBe(true);

    });

    it('operator-role plus --yes succeeds, change directory deleted', async () => {

        await seedConfig({ user: 'operator', agent: 'admin' });

        const result = runRm(['--yes']);

        expect(result.status).toBe(0);
        expect(existsSync(changePath)).toBe(false);

    });

    it('operator-role without --yes and without NOORM_YES is blocked, disk untouched', async () => {

        await seedConfig({ user: 'operator', agent: 'admin' });

        const result = runRm();

        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain('Pass --yes');
        expect(existsSync(changePath)).toBe(true);

    });

    it('admin-role plus NOORM_YES=1, no --yes flag, succeeds — proves the isYesMode fix', async () => {

        await seedConfig({ user: 'admin', agent: 'admin' });

        const result = runRm([], { NOORM_YES: '1' });

        expect(result.status).toBe(0);
        expect(existsSync(changePath)).toBe(false);

    });

});
