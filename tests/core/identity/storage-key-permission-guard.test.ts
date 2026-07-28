/**
 * core/identity: loadPrivateKey — key-permission guard wiring.
 *
 * `validateKeyPermissions()` derives PRIVATE_KEY_PATH from `homedir()` at
 * module import time, so it can't be redirected in-process to a fake
 * `~/.noorm`. Each case spawns a fresh `bun -e` subprocess against the
 * built dist output with `HOME` repointed at a throwaway tmp dir, matching
 * the subprocess-isolation idiom used by tests/cli/db/transfer.test.ts.
 *
 * Regression under test: `validateKeyPermissions()` was exported dead code
 * with zero callers — a world-readable identity.key on disk was silently
 * accepted by `loadPrivateKey()`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const STORAGE_MODULE = join(process.cwd(), 'dist/core/identity/storage.js');

const LOAD_PRIVATE_KEY_SCRIPT = `
    import(${JSON.stringify(STORAGE_MODULE)}).then(async (m) => {
        const key = await m.loadPrivateKey();
        process.stdout.write('OK:' + key);
    }).catch((err) => {
        process.stderr.write('ERR:' + err.message);
        process.exit(1);
    });
`;

describe('identity: storage (loadPrivateKey permission guard)', () => {

    let fakeHome: string;
    let keyPath: string;

    beforeEach(() => {

        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-key-guard-home-'));
        mkdirSync(join(fakeHome, '.noorm'), { recursive: true });
        keyPath = join(fakeHome, '.noorm', 'identity.key');

    });

    afterEach(() => {

        rmSync(fakeHome, { recursive: true, force: true });

    });

    function runLoadPrivateKey() {

        return spawnSync('bun', ['-e', LOAD_PRIVATE_KEY_SCRIPT], {
            encoding: 'utf-8',
            env: { ...process.env, HOME: fakeHome },
        });

    }

    it('rejects a world-readable private key', () => {

        writeFileSync(keyPath, 'a'.repeat(96), { mode: 0o644 });
        chmodSync(keyPath, 0o644);

        const result = runLoadPrivateKey();

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('chmod 600');

    });

    it('resolves a private key with secure permissions', () => {

        const key = 'a'.repeat(96);
        writeFileSync(keyPath, key, { mode: 0o600 });
        chmodSync(keyPath, 0o600);

        const result = runLoadPrivateKey();

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`OK:${key}`);

    });

});
