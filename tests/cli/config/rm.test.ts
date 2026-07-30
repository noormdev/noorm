/**
 * cli: noorm config delete command -- headless deletion + access policy gate.
 *
 * Driven as a subprocess against the compiled CLI (db/drop.test.ts's
 * pattern) since the command calls process.exit. Identity comes from
 * NOORM_IDENTITY_* env vars, and config fixtures are written directly
 * via StateManager since config add/edit are TUI-only stubs. The
 * locked-stage scenario also seeds a real settings.yml with a stage
 * whose name matches the config name, so SettingsProvider.findStageForConfig
 * auto-links it, exercising the real ConfigStageLockedError path -- not
 * a mock.
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
const CONFIG_NAME = 'staging';
const LOCKED_CONFIG_NAME = 'lockedcfg';

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

describe('cli: noorm config delete command -- access policy gate', () => {

    let tmpDir: string;
    let fakeHome: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-config-delete-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-config-delete-home-'));
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

    /** Writes a real encrypted state.enc with one config at the given access role, bypassing the TUI-only config add/edit commands. */
    async function seedConfig(name: string, access: ConfigAccess): Promise<void> {

        const config: Config = {
            name,
            type: 'local',
            isTest: true,
            access,
            connection: { dialect: 'sqlite', database: join(tmpDir, `${name}.db`) },
        };

        const manager = new StateManager(tmpDir, { privateKey });
        await manager.load();
        await manager.setConfig(name, config);

    }

    /** Writes a stage in settings.yml matching stageName, locked so any config auto-linked to it (same-name config) cannot be deleted. */
    function writeLockedStage(stageName: string): void {

        writeFileSync(
            join(tmpDir, '.noorm', 'settings.yml'),
            `paths:\n    sql: ./sql\nstages:\n    ${stageName}:\n        locked: true\n`,
        );

    }

    function runDelete(args: string[] = [], envOverrides: Record<string, string | undefined> = {}) {

        return spawnSync('node', [CLI, 'config', 'rm', ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: { ...identityEnv, ...envOverrides },
        });

    }

    async function configExists(name: string): Promise<boolean> {

        const manager = new StateManager(tmpDir, { privateKey });
        await manager.load();

        return manager.getConfig(name) !== null;

    }

    it('deletes an admin config when --yes is passed', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: 'admin' });

        const result = runDelete([CONFIG_NAME, '--yes']);

        expect(result.status).toBe(0);
        expect(await configExists(CONFIG_NAME)).toBe(false);

    });

    it('refuses an admin config without --yes or NOORM_YES, naming the confirmation phrase', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: 'admin' });

        const result = runDelete([CONFIG_NAME]);

        expect(result.status).toBe(1);
        const out = result.stdout + result.stderr;
        expect(out).toContain(`yes-${CONFIG_NAME}`);
        expect(out).toContain('Pass --yes to confirm');
        expect(await configExists(CONFIG_NAME)).toBe(true);

    });

    it('deletes when NOORM_YES=1 is set without --yes', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: 'admin' });

        const result = runDelete([CONFIG_NAME], { NOORM_YES: '1' });

        expect(result.status).toBe(0);
        expect(await configExists(CONFIG_NAME)).toBe(false);

    });

    it('exits 2 with a clear message for an unknown config name, mutating nothing', async () => {

        const result = runDelete(['does-not-exist', '--yes']);

        expect(result.status).toBe(2);
        const out = result.stdout + result.stderr;
        expect(out).toContain('"does-not-exist" not found');

    });

    it('refuses to delete a config linked to a locked stage even with --yes, and leaves it intact', async () => {

        await seedConfig(LOCKED_CONFIG_NAME, { user: 'admin', agent: 'admin' });
        writeLockedStage(LOCKED_CONFIG_NAME);

        const result = runDelete([LOCKED_CONFIG_NAME, '--yes']);

        expect(result.status).toBe(1);
        const out = result.stdout + result.stderr;
        expect(out).toContain('linked to locked stage');
        expect(out).toContain(LOCKED_CONFIG_NAME);
        expect(await configExists(LOCKED_CONFIG_NAME)).toBe(true);

    });

    it('denies a viewer with the policy blockedReason and leaves the config intact', async () => {

        await seedConfig(CONFIG_NAME, { user: 'viewer', agent: 'admin' });

        const result = runDelete([CONFIG_NAME, '--yes']);

        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain(
            `"config:rm" is not allowed on config "${CONFIG_NAME}" (role: viewer).`,
        );
        expect(await configExists(CONFIG_NAME)).toBe(true);

    });

});
