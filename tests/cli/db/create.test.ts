/**
 * cli: noorm db create — fresh-create vs already-exists short-circuit.
 *
 * `db create` calls `process.exit`, so — like every other citty command test
 * in this suite — it's driven as a subprocess against the compiled CLI
 * rather than invoked in-process (an in-process call would kill the test
 * runner on the first `process.exit`). Identity comes from `NOORM_IDENTITY_*`
 * env vars (env-bootstrap.test.ts's pattern) so no `~/.noorm/identity.key`
 * is ever touched, and the config fixture is written directly via
 * `StateManager` (tests/cli/db/drop.test.ts's pattern) since `config
 * add`/`edit` are TUI-only. The target "database" is a real SQLite file, so
 * both the fresh-create path and the already-initialized short-circuit
 * exercise real file/tracking-table state, not stubs.
 *
 * Unlike `db drop`, `db create` has no policy gate at all (no
 * `checkConfigPolicy`/`assertPolicy` call in `src/cli/db/create.ts` or
 * `createDb`) — a real asymmetry flagged as a finding, not fixed here. So
 * this file seeds a role that would pass under any gate (`admin`/`admin`)
 * and has no role-denial cases to mirror from `drop.test.ts`.
 *
 * A second finding surfaced while writing these tests — `createDb`'s
 * `created` flag was deterministically `false` for SQLite targets even on a
 * genuine fresh create. Fixed under ticket 35: SQLite existence is captured
 * before the connectivity probe auto-creates the file, and the CLI threads its
 * status into `createDb`. The two `created`-flag tests below pin that behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import { checkDbStatus } from '../../../src/core/db/index.js';
import type { Config } from '../../../src/core/config/types.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const CONFIG_NAME = 'createme';

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

describe('cli: noorm db create — fresh vs already-exists', () => {

    let tmpDir: string;
    let fakeHome: string;
    let dbPath: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-db-create-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-db-create-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');

        dbPath = join(tmpDir, 'target.db');

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
    async function seedConfig(access: ConfigAccess): Promise<Config> {

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

        return config;

    }

    function runCreate(args: string[] = [], envOverrides: Record<string, string | undefined> = {}) {

        return spawnSync('node', [CLI, 'db', 'create', ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: { ...identityEnv, ...envOverrides },
        });

    }

    it('creates the database and initializes tracking when the target does not exist yet', async () => {

        const config = await seedConfig({ user: 'admin', mcp: 'admin' });

        expect(existsSync(dbPath)).toBe(false);

        const result = runCreate(['--json']);

        expect(result.status).toBe(0);
        expect(existsSync(dbPath)).toBe(true);

        const status = await checkDbStatus(config.connection);
        expect(status.trackingInitialized).toBe(true);

        const parsed = JSON.parse(result.stdout);
        expect(parsed.trackingInitialized).toBe(true);

    });

    it('created is true when the JSON output reports a genuinely fresh create', async () => {

        await seedConfig({ user: 'admin', mcp: 'admin' });

        expect(existsSync(dbPath)).toBe(false);

        const result = runCreate(['--json']);

        expect(result.status).toBe(0);

        const parsed = JSON.parse(result.stdout);
        expect(parsed.created).toBe(true);

    });

    it('created is false when the SQLite target file already existed before create ran', async () => {

        await seedConfig({ user: 'admin', mcp: 'admin' });

        writeFileSync(dbPath, '');

        const result = runCreate(['--json']);

        expect(result.status).toBe(0);

        const parsed = JSON.parse(result.stdout);
        expect(parsed.created).toBe(false);

    });

    it('short-circuits without re-running createDb when the target already exists and is initialized', async () => {

        const config = await seedConfig({ user: 'admin', mcp: 'admin' });

        const first = runCreate(['--json']);
        expect(first.status).toBe(0);

        const status = await checkDbStatus(config.connection);
        expect(status.exists).toBe(true);
        expect(status.trackingInitialized).toBe(true);

        const mtimeBefore = statSync(dbPath).mtimeMs;

        const second = runCreate(['--json']);

        expect(second.status).toBe(0);

        const parsed = JSON.parse(second.stdout);
        expect(parsed.alreadyExists).toBe(true);
        expect(parsed.created).toBe(false);

        expect(statSync(dbPath).mtimeMs).toBe(mtimeBefore);

    });

    it('targets the NOORM_CONNECTION_* database instead of the persisted config when both are set (#51)', async () => {

        await seedConfig({ user: 'admin', mcp: 'admin' });

        const envDbPath = join(tmpDir, 'env-target.db');

        expect(existsSync(dbPath)).toBe(false);
        expect(existsSync(envDbPath)).toBe(false);

        const result = runCreate(['--json'], { NOORM_CONNECTION_DATABASE: envDbPath });

        expect(result.status).toBe(0);
        expect(existsSync(envDbPath)).toBe(true);
        expect(existsSync(dbPath)).toBe(false);

        const parsed = JSON.parse(result.stdout);
        expect(parsed.database).toBe(envDbPath);

        const status = await checkDbStatus({ dialect: 'sqlite', database: envDbPath });
        expect(status.trackingInitialized).toBe(true);

    });

});
