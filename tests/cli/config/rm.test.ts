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
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import { encrypt, decrypt } from '../../../src/core/state/encryption/index.js';
import type { EncryptedPayload } from '../../../src/core/state/types.js';
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
            isTest: false,
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

    function readState() {

        const path = new StateManager(tmpDir, { privateKey }).getStatePath();

        return JSON.parse(decrypt(JSON.parse(readFileSync(path, 'utf8')) as EncryptedPayload, privateKey));

    }

    function runRepair(args: string[], env: Record<string, string> = {}) {

        return spawnSync('node', [CLI, 'config', 'repair-access', CONFIG_NAME, ...args], {
            cwd: tmpDir, encoding: 'utf-8', env: { ...identityEnv, ...env },
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
    it('allows only a confirmed human to remove an unknown user role', async () => {

        await seedConfig(CONFIG_NAME, { user: 'removed-role', agent: 'admin' });
        expect(runDelete([CONFIG_NAME, '--yes'], { NOORM_CHANNEL: 'agent' }).status).not.toBe(0);
        expect(await configExists(CONFIG_NAME)).toBe(true);
        expect(runDelete([CONFIG_NAME]).status).not.toBe(0);
        expect(await configExists(CONFIG_NAME)).toBe(true);
        expect(runDelete([CONFIG_NAME, '--yes']).status).toBe(0);
        expect(await configExists(CONFIG_NAME)).toBe(false);

    });

    it('does not bypass a known user denial when only the agent role is unknown', async () => {

        await seedConfig(CONFIG_NAME, { user: 'viewer', agent: 'removed-role' });
        const result = runDelete([CONFIG_NAME, '--yes']);
        expect(result.status).not.toBe(0);
        expect(await configExists(CONFIG_NAME)).toBe(true);

    });
    it('discovers and removes malformed access only through confirmed user recovery', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: 'admin' });
        const path = new StateManager(tmpDir, { privateKey }).getStatePath();
        const stored = JSON.parse(decrypt(JSON.parse(readFileSync(path, 'utf8')) as EncryptedPayload, privateKey));
        stored.configs[CONFIG_NAME].access = { user: 'admin' };
        writeFileSync(path, JSON.stringify(encrypt(JSON.stringify(stored), privateKey)));

        const list = spawnSync('node', [CLI, 'config', 'list', '--json'], {
            cwd: tmpDir, encoding: 'utf-8', env: identityEnv,
        });
        expect(list.status).toBe(0);
        expect(JSON.parse(list.stdout).accessErrors[0].name).toBe(CONFIG_NAME);
        expect(runDelete([CONFIG_NAME, '--yes'], { NOORM_CHANNEL: 'agent' }).status).not.toBe(0);
        expect(runDelete([CONFIG_NAME]).status).not.toBe(0);
        expect(runDelete([CONFIG_NAME, '--yes']).status).toBe(0);
        expect(await configExists(CONFIG_NAME)).toBe(false);

    });

    it('enforces recognizable user roles when the agent assignment is malformed', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: false });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'),
            'access:\n  roles:\n    restricted:\n      extends: admin\n      permissions:\n        config:write: deny\n        config:rm: deny\n');
        const path = new StateManager(tmpDir, { privateKey }).getStatePath();
        const stored = JSON.parse(decrypt(JSON.parse(readFileSync(path, 'utf8')) as EncryptedPayload, privateKey));
        for (const access of [{ user: 'viewer' }, { user: 'viewer', agent: null },
            { user: 'restricted' }, { user: 'restricted', agent: null }]) {

            stored.configs[CONFIG_NAME].access = access;
            writeFileSync(path, JSON.stringify(encrypt(JSON.stringify(stored), privateKey)));
            const repair = spawnSync('node', [CLI, 'config', 'repair-access', CONFIG_NAME,
                '--user', 'admin', '--agent', 'admin', '--yes'], {
                cwd: tmpDir, encoding: 'utf-8', env: identityEnv,
            });
            expect(repair.status).not.toBe(0);
            expect(repair.stdout + repair.stderr).toContain('config:write');
            expect(runDelete([CONFIG_NAME, '--yes']).status).not.toBe(0);
            const after = JSON.parse(decrypt(JSON.parse(readFileSync(path, 'utf8')) as EncryptedPayload, privateKey));
            expect(after).toEqual(stored);

        }

    });

    it('repairs invalid access in encrypted state only for a confirmed user with valid replacement roles', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: 'admin' });
        await seedConfig('other', { user: 'viewer', agent: false });
        const manager = new StateManager(tmpDir, { privateKey });
        await manager.load();
        await manager.setSecret(CONFIG_NAME, 'TOKEN', 'secret-value');
        await manager.setSecret('other', 'TOKEN', 'other-secret');
        await manager.setGlobalSecret('GLOBAL', 'global-secret');
        const path = manager.getStatePath();
        const stored = readState();
        stored.configs[CONFIG_NAME].access = { user: 'admin' };
        writeFileSync(path, JSON.stringify(encrypt(JSON.stringify(stored), privateKey)));
        const roles = ['--user', 'viewer', '--agent', 'false'];
        for (const [args, env] of [
            [roles, {}],
            [roles, { NOORM_YES: '1' }],
            [[...roles, '--yes'], { NOORM_CHANNEL: 'agent' }],
            [['--user', 'unknown', '--agent', 'false', '--yes'], {}],
            [['--user', 'viewer', '--agent', 'unknown', '--yes'], {}],
            [['--user', 'viewer', '--yes'], {}],
        ] as [string[], Record<string, string>][]) {

            expect(runRepair(args, env).status).not.toBe(0);
            expect(readState()).toEqual(stored);

        }
        const repaired = runRepair([...roles, '--yes']);
        expect(repaired.status).toBe(0);
        expect(repaired.stdout + repaired.stderr).not.toContain('secret-value');
        const expected = structuredClone(stored);
        expected.configs[CONFIG_NAME].access = { user: 'viewer', agent: false };
        expect(readState()).toEqual(expected);
        expect(runRepair(['--user', 'admin', '--agent', 'admin', '--yes']).status).not.toBe(0);
        expect(readState()).toEqual(expected);

    });

    it('repairs unknown role assignments without overriding a known user role denial', async () => {

        await seedConfig(CONFIG_NAME, { user: 'removed-role', agent: false });
        const repairToViewer = () => runRepair(['--user', 'viewer', '--agent', 'false', '--yes']);
        expect(repairToViewer().status).toBe(0);
        const manager = new StateManager(tmpDir, { privateKey });
        await manager.load();
        expect(manager.getConfig(CONFIG_NAME)?.access).toEqual({ user: 'viewer', agent: false });
        await manager.setConfig(CONFIG_NAME, { ...manager.getConfig(CONFIG_NAME)!, access: { user: 'viewer', agent: 'removed-role' } });
        expect(repairToViewer().status).not.toBe(0);
        const reader = new StateManager(tmpDir, { privateKey });
        await reader.load();
        expect(reader.getConfig(CONFIG_NAME)?.access).toEqual({ user: 'viewer', agent: 'removed-role' });
        await reader.setConfig(CONFIG_NAME, { ...reader.getConfig(CONFIG_NAME)!, access: { user: 'admin', agent: 'removed-role' } });
        expect(repairToViewer().status).toBe(0);
        const repaired = new StateManager(tmpDir, { privateKey });
        await repaired.load();
        expect(repaired.getConfig(CONFIG_NAME)?.access).toEqual({ user: 'viewer', agent: false });

    });

    it('repair-access on an unresolvable stored role or malformed access needs a confirmed user, never an agent', async () => {

        await seedConfig(CONFIG_NAME, { user: 'prod-op', agent: 'prod-op' });
        const path = new StateManager(tmpDir, { privateKey }).getStatePath();
        const roles = ['--user', 'admin', '--agent', 'admin'];

        for (const access of [{ user: 'prod-op', agent: 'prod-op' }, 'garbage', {}, null]) {

            const stored = readState();
            stored.configs[CONFIG_NAME].access = access;
            writeFileSync(path, JSON.stringify(encrypt(JSON.stringify(stored), privateKey)));
            const before = readState();

            const agent = runRepair([...roles, '--yes'], { NOORM_CHANNEL: 'agent' });
            const noYes = runRepair(roles);
            const envYes = runRepair(roles, { NOORM_YES: '1' });

            for (const refused of [agent, noYes, envYes]) expect(refused.status).not.toBe(0);
            expect(agent.stdout + agent.stderr).toContain('user channel');
            expect(noYes.stdout + noYes.stderr).toContain('--yes');
            expect(envYes.stdout + envYes.stderr).toContain('--yes');
            expect(readState()).toEqual(before);

            expect(runRepair([...roles, '--yes']).status).toBe(0);
            expect(readState().configs[CONFIG_NAME].access).toEqual({ user: 'admin', agent: 'admin' });

        }

    }, 30_000);

});
