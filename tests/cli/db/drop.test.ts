/**
 * cli: noorm db drop — access-role policy gate.
 *
 * `db drop` is destructive and calls `process.exit`, so — like every other
 * citty command test in this suite — it's driven as a subprocess against
 * the compiled CLI rather than invoked in-process (an in-process call would
 * kill the test runner on the first `process.exit`). Identity comes from
 * `NOORM_IDENTITY_*` env vars (env-bootstrap.test.ts's pattern) so no
 * `~/.noorm/identity.key` is ever touched, and the config fixture is
 * written directly via `StateManager` (tests/core/rpc/list-configs.test.ts's
 * pattern) since `config add`/`edit` are TUI-only and can't set an exact
 * `access` role from the CLI. The target "database" is a real SQLite file —
 * dropping it is a real file deletion, not a stub, so `--yes` exercises the
 * actual drop path end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import type { Config } from '../../../src/core/config/types.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const CONFIG_NAME = 'dropme';

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

describe('cli: noorm db drop — access policy gate', () => {

    let tmpDir: string;
    let fakeHome: string;
    let dbPath: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-db-drop-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-db-drop-home-'));
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

    /** Writes a real encrypted state.enc with one active config at the given access role, bypassing the TUI-only `config add`/`edit` commands. */
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

    function runDrop(args: string[] = [], envOverrides: Record<string, string | undefined> = {}) {

        return spawnSync('node', [CLI, 'db', 'drop', ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: { ...identityEnv, ...envOverrides },
        });

    }

    it('denies a viewer with the policy blockedReason and leaves the database intact', async () => {

        await seedConfig({ user: 'viewer', mcp: 'admin' });

        const result = runDrop();

        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain(
            `"db:destroy" is not allowed on config "${CONFIG_NAME}" (role: viewer).`,
        );
        expect(existsSync(dbPath)).toBe(true);

    });

    it('denies an operator with the policy blockedReason and leaves the database intact', async () => {

        await seedConfig({ user: 'operator', mcp: 'admin' });

        const result = runDrop();

        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain(
            `"db:destroy" is not allowed on config "${CONFIG_NAME}" (role: operator).`,
        );
        expect(existsSync(dbPath)).toBe(true);

    });

    it('blocks an admin without --yes or NOORM_YES, naming the confirmation phrase', async () => {

        await seedConfig({ user: 'admin', mcp: 'admin' });

        const result = runDrop();

        expect(result.status).toBe(1);
        const out = result.stdout + result.stderr;
        expect(out).toContain(`yes-${CONFIG_NAME}`);
        expect(out).toContain('Pass --yes to confirm');
        expect(existsSync(dbPath)).toBe(true);

    });

    it('proceeds to the real drop when an admin passes --yes', async () => {

        await seedConfig({ user: 'admin', mcp: 'admin' });

        const result = runDrop(['--yes']);

        expect(result.status).toBe(0);
        expect(existsSync(dbPath)).toBe(false);

    });

    it('proceeds to the real drop when NOORM_YES=1 is set without --yes', async () => {

        await seedConfig({ user: 'admin', mcp: 'admin' });

        const result = runDrop([], { NOORM_YES: '1' });

        expect(result.status).toBe(0);
        expect(existsSync(dbPath)).toBe(false);

    });

    it('targets the NOORM_CONNECTION_* database instead of the persisted config when both are set (#51)', async () => {

        await seedConfig({ user: 'admin', mcp: 'admin' });

        const envDbPath = join(tmpDir, 'env-target.db');
        writeFileSync(envDbPath, '');

        const result = runDrop(['--yes'], { NOORM_CONNECTION_DATABASE: envDbPath });

        expect(result.status).toBe(0);
        expect(existsSync(envDbPath)).toBe(false);
        expect(existsSync(dbPath)).toBe(true);

    });

});
