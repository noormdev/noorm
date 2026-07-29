/**
 * cli: noorm sql history / clear — which config's history they operate on.
 *
 * `SqlHistoryManager` is correct and unit-tested, but it is told which config
 * to work on, and both commands used to hardcode the literal name `default`.
 * Nothing in the product ever writes history under that name — the TUI keys
 * it by the *active* config — so `noorm sql clear --yes` reported success
 * while leaving whatever the user was trying to scrub on disk.
 *
 * That is invisible to a unit test of the manager, which is handed the name
 * explicitly. It only shows up end to end, so — like the other citty command
 * tests in this suite — this drives the compiled CLI as a subprocess (also
 * unavoidable: these commands call `process.exit`). Identity comes from
 * `NOORM_IDENTITY_*` so no `~/.noorm/identity.key` is touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import { SqlHistoryManager } from '../../../src/core/sql-terminal/history.js';
import type { Config } from '../../../src/core/config/types.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const ACTIVE_CONFIG = 'audit';
const OTHER_CONFIG = 'staging';

/** A query text that would be a real leak if `clear` claimed to remove it and didn't. */
const SECRET_QUERY = "SELECT * FROM vault WHERE token = 'ghp_SUPERSECRET_TOKEN'";

/** Strips inherited NOORM_* env vars before applying explicit overrides, so no ambient NOORM_CONFIG leaks into a subprocess run. */
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

describe('cli: noorm sql history/clear — config resolution', () => {

    let tmpDir: string;
    let fakeHome: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(async () => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-sql-history-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-sql-history-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');

        privateKey = generateKeyPair().privateKey;
        identityEnv = cleanEnvWithOverrides({
            HOME: fakeHome,
            NOORM_IDENTITY_PRIVATE_KEY: privateKey,
            NOORM_IDENTITY_NAME: 'CI Bot',
            NOORM_IDENTITY_EMAIL: 'ci@example.com',
        });

        const manager = new StateManager(tmpDir, { privateKey });

        await manager.load();

        for (const name of [ACTIVE_CONFIG, OTHER_CONFIG]) {

            const config: Config = {
                name,
                type: 'local',
                isTest: true,
                access: { user: 'admin', mcp: 'admin' },
                connection: { dialect: 'sqlite', database: join(tmpDir, `${name}.db`) },
            };

            await manager.setConfig(name, config);

        }

        await manager.setActiveConfig(ACTIVE_CONFIG);

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });

    });

    /** Writes one history entry for `configName`, exactly as the TUI SQL terminal does. */
    async function seedHistory(configName: string, query: string): Promise<void> {

        const history = new SqlHistoryManager(tmpDir, configName);

        await history.addEntry(query, {
            success: true,
            columns: ['token'],
            rows: [{ token: 'ghp_SUPERSECRET_TOKEN' }],
            durationMs: 1,
        });

    }

    function runSql(args: string[], envOverrides: Record<string, string | undefined> = {}) {

        const result = spawnSync('node', [CLI, 'sql', ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: { ...identityEnv, ...envOverrides },
        });

        return { ...result, json: JSON.parse(result.stdout) as Record<string, unknown> };

    }

    function historyFile(configName: string): string {

        return join(tmpDir, '.noorm', 'state', 'history', `${configName}.json`);

    }

    it('reads the active config history, not a config literally named "default"', async () => {

        await seedHistory(ACTIVE_CONFIG, SECRET_QUERY);

        const { json } = runSql(['history', '--json']);

        expect(json['configName']).toBe(ACTIVE_CONFIG);
        expect(json['entries']).toHaveLength(1);

    });

    it('actually erases the active config history that it reports clearing', async () => {

        await seedHistory(ACTIVE_CONFIG, SECRET_QUERY);

        const { json } = runSql(['clear', '--yes', '--json']);

        expect(json['configName']).toBe(ACTIVE_CONFIG);
        expect(json['entriesRemoved']).toBe(1);
        expect(readFileSync(historyFile(ACTIVE_CONFIG), 'utf-8')).not.toContain('ghp_SUPERSECRET_TOKEN');

    });

    it('does not create a stray "default" history file as a side effect of clearing', async () => {

        await seedHistory(ACTIVE_CONFIG, SECRET_QUERY);

        runSql(['clear', '--yes', '--json']);

        expect(existsSync(historyFile('default'))).toBe(false);

    });

    it('leaves other configs\' history untouched', async () => {

        await seedHistory(ACTIVE_CONFIG, SECRET_QUERY);
        await seedHistory(OTHER_CONFIG, 'SELECT 1');

        runSql(['clear', '--yes', '--json']);

        expect(readFileSync(historyFile(OTHER_CONFIG), 'utf-8')).toContain('SELECT 1');

    });

    it('honours an explicit --config over the active one', async () => {

        await seedHistory(OTHER_CONFIG, 'SELECT 1');

        const { json } = runSql(['history', '--json', '--config', OTHER_CONFIG]);

        expect(json['configName']).toBe(OTHER_CONFIG);
        expect(json['entries']).toHaveLength(1);

    });

    it('honours NOORM_CONFIG, matching how `sql query` picks its config', async () => {

        await seedHistory(OTHER_CONFIG, 'SELECT 1');

        const { json } = runSql(['history', '--json'], { NOORM_CONFIG: OTHER_CONFIG });

        expect(json['configName']).toBe(OTHER_CONFIG);
        expect(json['entries']).toHaveLength(1);

    });

    it('reports the resolved config name when there is no history for it', () => {

        const { json } = runSql(['history', '--json']);

        expect(json['configName']).toBe(ACTIVE_CONFIG);
        expect(json['entries']).toEqual([]);

    });

});
