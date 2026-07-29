/**
 * cli: noorm lock status — result on stdout, diagnostics on stderr (CP4).
 *
 * Mirrors tests/cli/change/list.test.ts's harness. Before the CP4 fix,
 * "No active lock" (and the locked-by summary) went to `logger.info`,
 * which always routed to stderr in text mode — invisible to a CI step
 * capturing stdout only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import type { Config } from '../../../src/core/config/types.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const CONFIG_NAME = 'lockstatus';

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

describe('cli: noorm lock status — output streams', () => {

    let tmpDir: string;
    let fakeHome: string;
    let dbPath: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-lock-status-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-lock-status-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');

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

    function runStatus(args: string[] = []) {

        return spawnSync('node', [CLI, 'lock', 'status', ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: identityEnv,
        });

    }

    it('prints "No active lock" to stdout, not stderr, when unlocked', async () => {

        await seedConfig();

        const result = runStatus();

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('No active lock');

    });

    it('--json prints exactly one parseable JSON document to stdout', async () => {

        await seedConfig();

        const result = runStatus(['--json']);

        expect(result.status).toBe(0);

        const parsed = JSON.parse(result.stdout);
        expect(parsed).toEqual({ success: true, isLocked: false, lock: null });

    });

});
