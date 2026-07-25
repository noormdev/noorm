/**
 * cli: noorm change list — result on stdout, diagnostics on stderr (CP4, #52).
 *
 * Mirrors tests/cli/db/create.test.ts's harness: driven as a subprocess
 * against the compiled CLI (list.ts calls `process.exit`, which would kill
 * an in-process test runner). Identity comes from `NOORM_IDENTITY_*` env
 * vars, and the config fixture is written directly via `StateManager` since
 * `config add`/`edit` are TUI-only. The target is a real (empty) SQLite
 * file — `withContext` bootstraps tracking tables on connect, so no
 * separate `db create` step is needed for a read-only list.
 *
 * Before the CP4 fix, `change list` produced no output at all on stdout in
 * either mode: the table (or, on an empty database, nothing) went to
 * stderr via `logger.info`, and `--json` piped its NDJSON event stream
 * ahead of the payload onto stdout. These tests capture stdout and stderr
 * separately (never merged with `2>&1`) so each stream's content is
 * unambiguous.
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
const CONFIG_NAME = 'changelist';

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

describe('cli: noorm change list — output streams', () => {

    let tmpDir: string;
    let fakeHome: string;
    let dbPath: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-change-list-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-change-list-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(
            join(tmpDir, '.noorm', 'settings.yml'),
            'paths:\n    sql: ./sql\n    changes: ./changes\n',
        );

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

    function runList(args: string[] = [], envOverrides: Record<string, string | undefined> = {}) {

        return spawnSync('node', [CLI, 'change', 'list', ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: { ...identityEnv, ...envOverrides },
        });

    }

    it('prints an explicit empty-state line to stdout, not silence, when there are no changes', async () => {

        await seedConfig();

        const result = runList();

        expect(result.status).toBe(0);
        expect(result.stdout.trim()).not.toBe('');
        expect(result.stdout).toMatch(/no changes/i);

    });

    it('--json prints exactly one parseable JSON document to stdout, with no NDJSON noise ahead of it', async () => {

        await seedConfig();

        const result = runList(['--json']);

        expect(result.status).toBe(0);

        const parsed = JSON.parse(result.stdout);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toEqual([]);

    });

    it('genuine diagnostics (a failed context) still land on stderr, not stdout', async () => {

        const result = runList(['-c', 'does-not-exist']);

        expect(result.status).toBe(1);
        expect(result.stderr).not.toBe('');
        expect(result.stdout).toBe('');

    });

});
