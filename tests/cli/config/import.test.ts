/**
 * cli: noorm config import — legacy `protected` fail-open regression.
 *
 * `config import` calls `process.exit`, so — like every other citty command
 * test in this suite — it's driven as a subprocess against the compiled CLI
 * rather than invoked in-process (tests/cli/db/drop.test.ts's pattern).
 * Identity comes from `NOORM_IDENTITY_*` env vars (env-bootstrap.test.ts's
 * pattern) so no `~/.noorm/identity.key` is ever touched; the persisted
 * `access` is read back directly via `StateManager` rather than parsing
 * `config list` text output.
 *
 * Regression: `parseConfig()` inside `import.ts` used to cast the raw JSON
 * straight to `Config` (`obj as unknown as Config`), bypassing `ConfigSchema`
 * entirely. A legacy export with `protected: true` and no `access` landed in
 * state access-less; the load-boundary backfill then hardcoded
 * `resolveLegacyAccess(config.access, undefined)`, resolving to the
 * admin/admin open default instead of the documented operator/viewer
 * fail-closed mapping.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import { decrypt } from '../../../src/core/state/encryption/index.js';
import type { EncryptedPayload } from '../../../src/core/state/types.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');

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

describe('cli: noorm config import — legacy protected mapping', () => {

    let tmpDir: string;
    let fakeHome: string;
    let privateKey: string;
    let identityEnv: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-config-import-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-config-import-home-'));
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

    /** Writes a raw config JSON file, the shape `config export` (or a legacy exporter) would produce. */
    function writeConfigFile(fileName: string, config: Record<string, unknown>): string {

        const filePath = join(tmpDir, fileName);
        writeFileSync(filePath, JSON.stringify(config));

        return filePath;

    }

    function runImport(path: string, args: string[] = []) {

        return spawnSync('node', [CLI, 'config', 'import', path, ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: identityEnv,
        });

    }

    /**
     * Reads the `access` a config was persisted with immediately after
     * import, decrypting state.enc directly rather than going through a
     * fresh `StateManager.load()` — a subsequent load's boundary backfill
     * would itself resolve a missing `access`, masking a regression in
     * `import.ts`'s own parse path.
     */
    function readPersistedAccess(name: string): unknown {

        const statePath = new StateManager(tmpDir, { privateKey }).getStatePath();
        const raw = readFileSync(statePath, 'utf8');
        const decrypted = JSON.parse(
            decrypt(JSON.parse(raw) as EncryptedPayload, privateKey),
        ) as { configs: Record<string, { access?: unknown }> };

        return decrypted.configs[name]?.access;

    }

    it('maps a legacy protected:true config with no access to guarded roles, not the fail-open admin/admin default', () => {

        const path = writeConfigFile('legacy.json', {
            name: 'legacy-guarded',
            protected: true,
            connection: { dialect: 'sqlite', database: ':memory:' },
        });

        const result = runImport(path);

        expect(result.status).toBe(0);

        const access = readPersistedAccess('legacy-guarded');
        expect(access).toEqual({ user: 'operator', agent: 'viewer' });

    });

    it('round-trips a config that already carries access unchanged', () => {

        const path = writeConfigFile('modern.json', {
            name: 'modern-viewer',
            access: { user: 'viewer', agent: false },
            connection: { dialect: 'sqlite', database: ':memory:' },
        });

        const result = runImport(path);

        expect(result.status).toBe(0);

        const access = readPersistedAccess('modern-viewer');
        expect(access).toEqual({ user: 'viewer', agent: false });

    });

    it('rejects config JSON missing required fields instead of silently importing it', () => {

        const path = writeConfigFile('broken.json', { protected: true });

        const result = runImport(path);

        expect(result.status).toBe(2);
        expect(result.stdout + result.stderr).toContain('Error');

    });

    /**
     * Overwriting a config rewrites its `access` block, so import is an
     * escalation vector: without a gate, one `--force` turns a viewer config
     * (or one hidden from agents with `agent: false`) into admin/admin. The
     * existing config's role decides, not the incoming file's.
     */
    describe('access escalation via --force', () => {

        function importThenEscalate(access: Record<string, unknown>, escalateArgs: string[]) {

            const original = writeConfigFile('original.json', {
                name: 'locked',
                access,
                connection: { dialect: 'sqlite', database: ':memory:' },
            });

            expect(runImport(original).status).toBe(0);

            const escalated = writeConfigFile('escalated.json', {
                name: 'locked',
                access: { user: 'admin', agent: 'admin' },
                connection: { dialect: 'sqlite', database: ':memory:' },
            });

            return runImport(escalated, escalateArgs);

        }

        it('denies overwriting a viewer config, leaving its access intact', () => {

            const result = importThenEscalate({ user: 'viewer', agent: false }, ['--force']);

            expect(result.status).toBe(1);
            expect(result.stdout + result.stderr).toContain('config:write');
            expect(readPersistedAccess('locked')).toEqual({ user: 'viewer', agent: false });

        });

        it('requires confirmation before overwriting an admin config', () => {

            const result = importThenEscalate({ user: 'admin', agent: 'viewer' }, ['--force']);

            expect(result.status).toBe(1);
            expect(result.stdout + result.stderr).toContain('confirmation');
            expect(readPersistedAccess('locked')).toEqual({ user: 'admin', agent: 'viewer' });

        });

        it('overwrites an admin config once confirmation is given', () => {

            const result = importThenEscalate({ user: 'admin', agent: 'viewer' }, ['--force', '--yes']);

            expect(result.status).toBe(0);
            expect(readPersistedAccess('locked')).toEqual({ user: 'admin', agent: 'admin' });

        });

    });

});
