/**
 * cli: noorm db reset — CLI pre-gate + SDK yes-threading (v1-02-yes-flag CP-4).
 *
 * Mirrors tests/cli/db/drop.test.ts's harness: driven as a subprocess
 * against the compiled CLI (reset/truncate/teardown all call
 * `process.exit`, which would kill an in-process test runner). Identity
 * comes from `NOORM_IDENTITY_*` env vars, and the config fixture is written
 * directly via `StateManager` since `config add`/`edit` are TUI-only and
 * can't set an exact `access` role from the CLI.
 *
 * Unlike `db drop` (a CLI-only role gate), `db reset`/`truncate`/`teardown`
 * gate through the SDK's `checkProtectedConfig` — an operator-role config
 * hits a `confirm` matrix cell there, resolved only by `options.yes`. These
 * tests therefore also prove the `yes: isYesMode(args)` threading from
 * `withContext` into `createContext` (spec C2/C3), not just `reset.ts`'s own
 * pre-gate. The target is a real SQLite file, so `--yes` exercises the
 * actual teardown/build path end-to-end, not a stub.
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
const CONFIG_NAME = 'resetme';

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

describe('cli: noorm db reset — pre-gate + yes threading', () => {

    let tmpDir: string;
    let fakeHome: string;
    let dbPath: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-db-reset-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-db-reset-home-'));
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

    function runReset(args: string[] = [], envOverrides: Record<string, string | undefined> = {}) {

        return spawnSync('node', [CLI, 'db', 'reset', ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: { ...identityEnv, ...envOverrides },
        });

    }

    it('blocks with the destructive-operation pre-gate when neither --yes nor NOORM_YES is set', async () => {

        await seedConfig({ user: 'admin', agent: 'admin' });

        const result = runReset();

        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain('This is a destructive operation. Pass --yes to confirm.');

    });

    it('passes the pre-gate and completes headlessly for an operator-role config with --yes', async () => {

        await seedConfig({ user: 'operator', agent: 'admin' });

        const result = runReset(['--yes']);

        const out = result.stdout + result.stderr;
        expect(out).not.toContain('Pass --yes to confirm');
        expect(result.status).toBe(0);

    });

    it('passes the pre-gate via NOORM_YES=1 alone, no --yes — the behavior CP-4 adds', async () => {

        // Base reset.ts checked bare `args.yes` only, so NOORM_YES=1 alone
        // used to fail at this exact pre-gate. Reverting reset.ts's
        // `isYesMode(args)` back to `args.yes` makes this fail (status 1,
        // "Pass --yes to confirm").
        await seedConfig({ user: 'operator', agent: 'admin' });

        const result = runReset([], { NOORM_YES: '1' });

        const out = result.stdout + result.stderr;
        expect(out).not.toContain('Pass --yes to confirm');
        expect(result.status).toBe(0);

    });

});

describe('cli: noorm db truncate/teardown/reset — operator-role --yes headless success (ticket acceptance criterion)', () => {

    let tmpDir: string;
    let fakeHome: string;
    let dbPath: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-db-yes-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-db-yes-home-'));
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

    function runDb(subcommand: string, args: string[] = []) {

        return spawnSync('node', [CLI, 'db', subcommand, ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: identityEnv,
        });

    }

    // truncate/teardown have no CLI pre-gate of their own — they rely on
    // withContext threading `yes: isYesMode(args)` into createContext, which
    // checkProtectedConfig then consults. If that threading regresses, these
    // fail closed (exit 1, ProtectedConfigError), not open.
    //
    // They now consult `db:truncate` and `db:teardown` rather than sharing
    // `db:reset`, which was `allow` for admin and so asked nothing of the
    // default config. `db:teardown` is `deny` below admin, so the operator
    // case that used to pass for teardown is now a denial.

    it('noorm db truncate --yes succeeds headlessly for an operator-role config (no NOORM_YES)', async () => {

        await seedConfig({ user: 'operator', agent: 'admin' });

        const result = runDb('truncate', ['--yes']);

        expect(result.status).toBe(0);

    });

    it('noorm db teardown --yes is denied for an operator-role config, because db:teardown stops below admin', async () => {

        await seedConfig({ user: 'operator', agent: 'admin' });

        const result = runDb('teardown', ['--yes']);

        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain('db:teardown');

    });

    it('noorm db reset --yes succeeds headlessly for an operator-role config (no NOORM_YES)', async () => {

        await seedConfig({ user: 'operator', agent: 'admin' });

        const result = runDb('reset', ['--yes']);

        expect(result.status).toBe(0);

    });

});
