/**
 * cli: noorm config export — output file mode hardening.
 *
 * `config export --output` calls `process.exit`, so — like every other
 * citty command test in this suite — it's driven as a subprocess against
 * the compiled CLI rather than invoked in-process (tests/cli/db/drop.test.ts's
 * pattern). Identity comes from `NOORM_IDENTITY_*` env vars (also
 * tests/cli/config/import.test.ts's pattern) so no `~/.noorm/identity.key`
 * is ever touched; the config fixture is seeded directly via `StateManager`
 * (tests/cli/db/drop.test.ts's pattern) since `config add`/`edit` are
 * TUI-only.
 *
 * Regression under test: the exported file used to inherit the process
 * umask (typically 0644), leaving plaintext credentials group/world
 * readable. `export --output` must write at 0600.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import type { Config } from '../../../src/core/config/types.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const CONFIG_NAME = 'exportme';

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

describe('cli: noorm config export — output file mode', () => {

    let tmpDir: string;
    let fakeHome: string;
    let outputPath: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(async () => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-config-export-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-config-export-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');

        outputPath = join(tmpDir, 'exported-config.json');

        privateKey = generateKeyPair().privateKey;
        identityEnv = cleanEnvWithOverrides({
            HOME: fakeHome,
            NOORM_IDENTITY_PRIVATE_KEY: privateKey,
            NOORM_IDENTITY_NAME: 'CI Bot',
            NOORM_IDENTITY_EMAIL: 'ci@example.com',
        });

        const config: Config = {
            name: CONFIG_NAME,
            type: 'local',
            isTest: true,
            access: { user: 'admin', mcp: 'admin' },
            connection: { dialect: 'sqlite', database: join(tmpDir, 'target.db') },
        };

        const manager = new StateManager(tmpDir, { privateKey });
        await manager.load();
        await manager.setConfig(CONFIG_NAME, config);

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });

    });

    function runExport(args: string[] = []) {

        return spawnSync('node', [CLI, 'config', 'export', CONFIG_NAME, '--output', outputPath, ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: identityEnv,
        });

    }

    it('writes the exported config file at mode 0600', () => {

        const result = runExport();

        expect(result.status).toBe(0);

        const stat = statSync(outputPath);
        expect(stat.mode & 0o777).toBe(0o600);

    });

    it('round-trips the config content into the exported file', () => {

        const result = runExport();

        expect(result.status).toBe(0);

        const content = readFileSync(outputPath, 'utf8');
        expect(content).toContain(CONFIG_NAME);

    });

    /**
     * Export hands over the connection password in plaintext, so it is a
     * secret read — but it was the one config operation with no gate at all.
     * A viewer config would refuse `config rm` and then export its own
     * password to stdout, exit 0.
     */
    describe('policy gate', () => {

        async function reseedWithViewerAccess() {

            const manager = new StateManager(tmpDir, { privateKey });
            await manager.load();
            await manager.setConfig(CONFIG_NAME, {
                name: CONFIG_NAME,
                type: 'local',
                isTest: true,
                access: { user: 'viewer', mcp: false },
                connection: {
                    dialect: 'sqlite',
                    database: join(tmpDir, 'target.db'),
                    password: 'TOPSECRETPROD',
                },
            } as Config);

        }

        it('refuses to write an export file for a viewer config', async () => {

            await reseedWithViewerAccess();

            const result = runExport();

            expect(result.status).toBe(1);
            expect(result.stdout + result.stderr).toContain('secret:read');
            expect(existsSync(outputPath)).toBe(false);

        });

        it('does not print a viewer config password to stdout', async () => {

            await reseedWithViewerAccess();

            const result = spawnSync('node', [CLI, 'config', 'export', CONFIG_NAME], {
                cwd: tmpDir,
                encoding: 'utf-8',
                env: identityEnv,
            });

            expect(result.status).toBe(1);
            expect(result.stdout).not.toContain('TOPSECRETPROD');

        });

    });

});
