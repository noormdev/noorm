/**
 * core/identity: loadPrivateKey — corrupted key-material guard.
 *
 * `Buffer.from(str, 'hex')` never throws: it stops at the first invalid pair
 * and truncates odd lengths. A corrupted, truncated or partially-synced
 * `~/.noorm/identity.key` therefore used to reduce to a zero-length HKDF
 * input, and `deriveStateKey` returned a CONSTANT that anyone can recompute
 * from the source. State written under it was effectively plaintext.
 *
 * `loadPrivateKey()` derives PRIVATE_KEY_PATH from `homedir()` at module
 * import time, so it can't be redirected in-process. Each case spawns a fresh
 * `bun -e` subprocess against the built dist output with `HOME` repointed at a
 * throwaway tmp dir — same idiom as storage-key-permission-guard.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const STORAGE_MODULE = join(process.cwd(), 'dist/core/identity/storage.js');
const CRYPTO_MODULE = join(process.cwd(), 'dist/core/identity/crypto.js');

const LOAD_PRIVATE_KEY_SCRIPT = `
    import(${JSON.stringify(STORAGE_MODULE)}).then(async (m) => {
        const key = await m.loadPrivateKey();
        process.stdout.write('OK:' + key);
    }).catch((err) => {
        process.stderr.write('ERR:' + err.message);
        process.exit(1);
    });
`;

/**
 * End-to-end reachability: read the on-disk key, then derive the state key
 * from it. Before the guard this printed a constant for every malformed key.
 */
const DERIVE_STATE_KEY_SCRIPT = `
    Promise.all([
        import(${JSON.stringify(STORAGE_MODULE)}),
        import(${JSON.stringify(CRYPTO_MODULE)}),
    ]).then(async ([storage, crypto]) => {
        const key = await storage.loadPrivateKey();
        process.stdout.write('DERIVED:' + crypto.deriveStateKey(key).toString('hex'));
    }).catch((err) => {
        process.stderr.write('ERR:' + err.message);
        process.exit(1);
    });
`;

describe('identity: storage (loadPrivateKey key-material guard)', () => {

    let fakeHome: string;
    let keyPath: string;

    beforeEach(() => {

        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-key-material-home-'));
        mkdirSync(join(fakeHome, '.noorm'), { recursive: true });
        keyPath = join(fakeHome, '.noorm', 'identity.key');

    });

    afterEach(() => {

        rmSync(fakeHome, { recursive: true, force: true });

    });

    function run(script: string) {

        return spawnSync('bun', ['-e', script], {
            encoding: 'utf-8',
            env: { ...process.env, HOME: fakeHome },
        });

    }

    function writeKey(contents: string) {

        writeFileSync(keyPath, contents, { mode: 0o600 });
        chmodSync(keyPath, 0o600);

    }

    it('rejects a non-hex private key file', () => {

        writeKey('corrupted-not-hex-at-all');

        const result = run(LOAD_PRIVATE_KEY_SCRIPT);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('ERR:');

    });

    it('rejects a truncated private key file', () => {

        writeKey('a'.repeat(40));

        const result = run(LOAD_PRIVATE_KEY_SCRIPT);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('ERR:');

    });

    it('rejects an empty private key file', () => {

        writeKey('');

        const result = run(LOAD_PRIVATE_KEY_SCRIPT);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('ERR:');

    });

    it('names the key file in the error so the operator can find it', () => {

        writeKey('zzzz');

        const result = run(LOAD_PRIVATE_KEY_SCRIPT);

        expect(result.stderr).toContain('identity.key');

    });

    it('never derives a state key from a corrupted key file', () => {

        writeKey('corrupted-not-hex-at-all');

        const result = run(DERIVE_STATE_KEY_SCRIPT);

        expect(result.status).toBe(1);
        expect(result.stdout).not.toContain('DERIVED:');

    });

    it('still loads a well-formed private key', () => {

        const key = 'a'.repeat(96);
        writeKey(key);

        const result = run(LOAD_PRIVATE_KEY_SCRIPT);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`OK:${key}`);

    });

});
