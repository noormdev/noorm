/**
 * cli: noorm config list — access tag display.
 *
 * `config list` reads state and exits (`process.exit`), so it's driven as
 * a subprocess against the compiled CLI (same reasoning as
 * tests/cli/db/drop.test.ts). The config fixture is written directly via
 * `StateManager` since `config add`/`edit` are TUI-only and can't set an
 * exact `access` role from the CLI.
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
const CONFIG_NAME = 'tagged';

/** Strips inherited NOORM_* env vars before applying explicit overrides, so no ambient NOORM_CONFIG/NOORM_YES leaks into a subprocess run. */
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

describe('cli: noorm config list — access tag display', () => {

    let tmpDir: string;
    let fakeHome: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-config-list-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-config-list-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');

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

    /** Writes a real encrypted state.enc with one config at the given access role, bypassing the TUI-only `config add`/`edit` commands. */
    async function seedConfig(access: ConfigAccess): Promise<void> {

        const config: Config = {
            name: CONFIG_NAME,
            type: 'local',
            isTest: false,
            access,
            protected: access.user !== 'admin',
            connection: { dialect: 'sqlite', database: join(tmpDir, 'target.db') },
        };

        const manager = new StateManager(tmpDir, { privateKey });
        await manager.load();
        await manager.setConfig(CONFIG_NAME, config);

    }

    function runList(): ReturnType<typeof spawnSync> {

        return spawnSync('node', [CLI, 'config', 'list'], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: identityEnv,
        });

    }

    it('renders "user:<role> mcp:<role>" for a guarded config', async () => {

        await seedConfig({ user: 'operator', mcp: 'viewer' });

        const result = runList();

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('user:operator mcp:viewer');

    });

    it('renders "mcp:off" when access.mcp is false', async () => {

        await seedConfig({ user: 'viewer', mcp: false });

        const result = runList();

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('user:viewer mcp:off');

    });

    it('renders no access tag for an admin/admin config', async () => {

        await seedConfig({ user: 'admin', mcp: 'admin' });

        const result = runList();

        expect(result.status).toBe(0);
        expect(result.stdout).not.toContain('user:');

    });

});
