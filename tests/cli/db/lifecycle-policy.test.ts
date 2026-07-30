/**
 * cli: destructive db lifecycle commands — access-policy enforcement.
 *
 * The audit found two holes the green suite could not see. `db create` ran
 * no policy check at all on the CLI while the TUI enforced `db:create`, so a
 * `viewer` — the role defined as read-only — performed DDL. And `db truncate`
 * / `db teardown` asked for nothing on the default `admin` role, because the
 * permission they consulted (`db:reset`) is `allow` for admin; `--yes` and
 * `--force` were declared args neither command read.
 *
 * These assert the *intent*: a destructive lifecycle command must be denied
 * for a role the matrix denies, and must refuse to run unconfirmed for a role
 * the matrix marks `confirm`. Driven as subprocesses against the compiled CLI
 * (the commands call `process.exit`) using `drop.test.ts`'s fixture pattern.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Database } from 'bun:sqlite';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import type { Config } from '../../../src/core/config/types.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const CONFIG_NAME = 'lifecycle';

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

describe('cli: db lifecycle access policy', () => {

    let tmpDir: string;
    let fakeHome: string;
    let dbPath: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-db-lifecycle-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-db-lifecycle-home-'));
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

    /** Seeds a real user table so a blocked truncate/teardown can be proven non-destructive rather than merely non-zero-exit. */
    function seedData(): void {

        const db = new Database(dbPath);
        db.run('CREATE TABLE IF NOT EXISTS widget (id INTEGER PRIMARY KEY, name TEXT)');
        db.run("INSERT INTO widget (name) VALUES ('a'), ('b'), ('c')");
        db.close();

    }

    function rowCount(): number {

        const db = new Database(dbPath);
        const row = db.query('SELECT count(*) AS n FROM widget').get() as { n: number };
        db.close();

        return row.n;

    }

    function runDb(subcommand: string, args: string[] = [], envOverrides: Record<string, string | undefined> = {}) {

        return spawnSync('node', [CLI, 'db', subcommand, ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: { ...identityEnv, ...envOverrides },
        });

    }

    // ─────────────────────────────────────────────────────
    // db create — the missing authorization check
    // ─────────────────────────────────────────────────────

    describe('db create', () => {

        it('denies a viewer and does not create the database', async () => {

            await seedConfig({ user: 'viewer', agent: 'admin' });

            const result = runDb('create');

            expect(result.status).toBe(1);
            expect(result.stdout + result.stderr).toContain(
                `"db:create" is not allowed on config "${CONFIG_NAME}" (role: viewer).`,
            );
            expect(existsSync(dbPath)).toBe(false);

        });

        it('blocks an operator without --yes, naming the confirmation phrase, and does not create the database', async () => {

            await seedConfig({ user: 'operator', agent: 'admin' });

            const result = runDb('create');

            expect(result.status).toBe(1);
            expect(result.stdout + result.stderr).toContain(`yes-${CONFIG_NAME}`);
            expect(existsSync(dbPath)).toBe(false);

        });

        it('creates for an operator that passes --yes', async () => {

            await seedConfig({ user: 'operator', agent: 'admin' });

            const result = runDb('create', ['--json', '--yes']);

            expect(result.status).toBe(0);
            expect(existsSync(dbPath)).toBe(true);

        });

        it('creates for an admin without --yes, because db:create is allow for admin', async () => {

            await seedConfig({ user: 'admin', agent: 'admin' });

            const result = runDb('create', ['--json']);

            expect(result.status).toBe(0);
            expect(existsSync(dbPath)).toBe(true);

        });

    });

    // ─────────────────────────────────────────────────────
    // db truncate — db:truncate is confirm for admin
    // ─────────────────────────────────────────────────────

    describe('db truncate', () => {

        it('refuses to wipe data for an admin that passed no --yes, and leaves every row in place', async () => {

            await seedConfig({ user: 'admin', agent: 'admin' });
            seedData();

            const result = runDb('truncate');

            expect(result.status).toBe(1);
            expect(result.stdout + result.stderr).toContain('requires confirmation');
            expect(rowCount()).toBe(3);

        });

        it('wipes data for an admin that passed --yes', async () => {

            await seedConfig({ user: 'admin', agent: 'admin' });
            seedData();

            const result = runDb('truncate', ['--yes']);

            expect(result.status).toBe(0);
            expect(rowCount()).toBe(0);

        });

        it('wipes data when NOORM_YES=1 is set without --yes', async () => {

            await seedConfig({ user: 'admin', agent: 'admin' });
            seedData();

            const result = runDb('truncate', [], { NOORM_YES: '1' });

            expect(result.status).toBe(0);
            expect(rowCount()).toBe(0);

        });

        it('denies a viewer outright and leaves every row in place', async () => {

            await seedConfig({ user: 'viewer', agent: 'admin' });
            seedData();

            const result = runDb('truncate', ['--yes']);

            expect(result.status).toBe(1);
            expect(result.stdout + result.stderr).toContain('db:truncate');
            expect(rowCount()).toBe(3);

        });

    });

    // ─────────────────────────────────────────────────────
    // db teardown — db:teardown is confirm for admin, deny below
    // ─────────────────────────────────────────────────────

    describe('db teardown', () => {

        it('refuses to drop objects for an admin that passed no --yes, and leaves the table standing', async () => {

            await seedConfig({ user: 'admin', agent: 'admin' });
            seedData();

            const result = runDb('teardown');

            expect(result.status).toBe(1);
            expect(result.stdout + result.stderr).toContain('requires confirmation');
            expect(rowCount()).toBe(3);

        });

        it('drops objects for an admin that passed --yes', async () => {

            await seedConfig({ user: 'admin', agent: 'admin' });
            seedData();

            const result = runDb('teardown', ['--yes']);

            expect(result.status).toBe(0);

            const db = new Database(dbPath);
            const found = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='widget'").all();
            db.close();

            expect(found).toEqual([]);

        });

        it('denies an operator even with --yes, because db:teardown is deny below admin', async () => {

            await seedConfig({ user: 'operator', agent: 'admin' });
            seedData();

            const result = runDb('teardown', ['--yes']);

            expect(result.status).toBe(1);
            expect(result.stdout + result.stderr).toContain('db:teardown');
            expect(rowCount()).toBe(3);

        });

        it('allows a dry run to preview without the confirmation an execution would need', async () => {

            await seedConfig({ user: 'admin', agent: 'admin' });
            seedData();

            const result = runDb('teardown', ['--dry-run', '--json']);

            expect(result.status).toBe(0);
            expect(rowCount()).toBe(3);

        });

    });

});
