/**
 * cli: noorm change history — result on stdout, diagnostics on stderr (CP4, #52).
 *
 * Mirrors tests/cli/change/list.test.ts's harness. Before the CP4 fix,
 * `change history --json` piped its NDJSON event stream ahead of the
 * result on stdout — the reason the field report had to `tail -1` instead
 * of piping straight into `jq`. These tests assert stdout parses as a
 * single JSON document with no `tail -1`, and that the human-readable
 * "0 records" line (an explicit non-silent statement) reaches stdout.
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
const CONFIG_NAME = 'changehistory';

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

describe('cli: noorm change history — output streams', () => {

    let tmpDir: string;
    let fakeHome: string;
    let dbPath: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-change-history-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-change-history-home-'));
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

    function runHistory(args: string[] = []) {

        return spawnSync('node', [CLI, 'change', 'history', ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: identityEnv,
        });

    }

    it('prints an explicit "0 records" line to stdout, not silence, on an empty database', async () => {

        await seedConfig();

        const result = runHistory();

        expect(result.status).toBe(0);
        expect(result.stdout.trim()).not.toBe('');
        expect(result.stdout).toContain('0 records');

    });

    it('--json prints exactly one parseable JSON document to stdout, with no NDJSON noise ahead of it', async () => {

        await seedConfig();

        const result = runHistory(['--json']);

        expect(result.status).toBe(0);

        // The envelope, not a bare array: `--json` is a contract, and a
        // top-level array leaves a consumer nowhere to read `success` from.
        const parsed = JSON.parse(result.stdout);
        expect(parsed.success).toBe(true);
        expect(Array.isArray(parsed.history)).toBe(true);
        expect(parsed.history).toEqual([]);

    });

});
