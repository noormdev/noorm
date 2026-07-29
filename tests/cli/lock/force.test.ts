/**
 * cli: noorm lock force — gating, holder reporting, and exit codes.
 *
 * WHY: `lock force` shipped with no confirmation and a hardcoded
 * `{ released: true }` payload, so it reported success and exit 0 on an empty
 * lock table and never named the holder it evicted. A CI step could not tell
 * "broke someone's lock" from "there was nothing there".
 *
 * Harness mirrors tests/cli/lock/status.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import type { Config } from '../../../src/core/config/types.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const CONFIG_NAME = 'lockforce';

/** Exit code the command uses for "nothing to release". */
const EXIT_NOTHING_TO_RELEASE = 2;

/** Strips inherited NOORM_* env vars so no ambient NOORM_YES leaks in. */
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

describe('cli: noorm lock force', () => {

    let tmpDir: string;
    let fakeHome: string;
    let dbPath: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-lock-force-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-lock-force-home-'));
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

    async function seedConfig(access: ConfigAccess = { user: 'admin', mcp: 'admin' }): Promise<void> {

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

    function run(command: string[], args: string[] = []) {

        return spawnSync('node', [CLI, ...command, ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: identityEnv,
        });

    }

    it('exits 2 and reports released:false when there is no lock to release', async () => {

        await seedConfig();

        const result = run(['lock', 'force'], ['--yes', '--json']);

        expect(result.status).toBe(EXIT_NOTHING_TO_RELEASE);

        const parsed = JSON.parse(result.stdout);

        expect(parsed.released).toBe(false);
        expect(parsed.holder).toBeNull();

    });

    it('names the evicted holder and exits 0 when a lock was released', async () => {

        await seedConfig();

        const acquired = run(['lock', 'acquire'], ['--json']);

        expect(acquired.status).toBe(0);

        const holder = JSON.parse(acquired.stdout).lockedBy;

        expect(holder).toBeTruthy();

        const result = run(['lock', 'force'], ['--yes', '--json']);

        expect(result.status).toBe(0);

        const parsed = JSON.parse(result.stdout);

        expect(parsed.released).toBe(true);

        // The reported holder must be the identity that actually held it,
        // not a placeholder — that is what makes the eviction reportable.
        expect(parsed.holder).toBe(holder);

    });

    it('refuses to break a lock without confirmation', async () => {

        await seedConfig();

        run(['lock', 'acquire'], ['--json']);

        const result = run(['lock', 'force'], ['--json']);

        expect(result.status).toBe(1);

        // The lock must survive a rejected force.
        const status = run(['lock', 'status'], ['--json']);
        const parsed = JSON.parse(status.stdout);

        expect(parsed.isLocked).toBe(true);

    });

    it('denies a viewer config even with --yes', async () => {

        await seedConfig({ user: 'viewer', mcp: false });

        const result = run(['lock', 'force'], ['--yes', '--json']);

        expect(result.status).toBe(1);

    });

});
