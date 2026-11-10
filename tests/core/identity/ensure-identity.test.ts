/**
 * core/identity: ensureIdentity never replaces a private key.
 *
 * State encryption is keyed off `identity.key`, so a setup path that
 * generates a keypair over an existing key makes every `state.enc` on the
 * machine unreadable. The old gate asked whether BOTH key files existed, and a
 * key restored on its own (no `identity.pub`) fell through to generation.
 *
 * Each case runs in a child process with HOME repointed at a throwaway
 * directory; see the fixture for why.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import type { CryptoIdentity } from '../../../src/core/identity/types.js';

const FIXTURE = join(import.meta.dir, 'fixtures', 'ensure-identity-home.ts');

const EXISTING_METADATA: CryptoIdentity = {
    identityHash: 'a'.repeat(64),
    name: 'Original Person',
    email: 'original@example.com',
    publicKey: 'replaced-below',
    machine: 'original-machine',
    os: 'darwin 24.5.0',
    createdAt: '2026-01-01T00:00:00.000Z',
};

describe('identity: ensureIdentity', () => {

    let fakeHome: string;
    let projectRoot: string;
    let keyPath: string;
    let pubPath: string;
    let metadataPath: string;

    beforeEach(() => {

        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-ensure-identity-home-'));
        projectRoot = mkdtempSync(join(tmpdir(), 'noorm-ensure-identity-proj-'));
        mkdirSync(join(fakeHome, '.noorm'), { recursive: true });

        keyPath = join(fakeHome, '.noorm', 'identity.key');
        pubPath = join(fakeHome, '.noorm', 'identity.pub');
        metadataPath = join(fakeHome, '.noorm', 'identity.json');

    });

    afterEach(() => {

        rmSync(fakeHome, { recursive: true, force: true });
        rmSync(projectRoot, { recursive: true, force: true });

    });

    function run(mode: 'seed' | 'ensure' | 'read') {

        const result = spawnSync('bun', ['run', FIXTURE, mode, projectRoot], {
            encoding: 'utf-8',
            env: { ...process.env, HOME: fakeHome },
        });

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);

        return result.stdout;

    }

    /** Puts a key on disk and encrypts a project's state with it. */
    function writeKey() {

        const keypair = generateKeyPair();

        writeFileSync(keyPath, keypair.privateKey, { mode: 0o600 });
        chmodSync(keyPath, 0o600);
        run('seed');

        return keypair;

    }

    it('should keep a key that has no public key file, and derive the public key from it', () => {

        const keypair = writeKey();
        const keyBytes = readFileSync(keyPath);

        const result = JSON.parse(run('ensure'));

        expect(readFileSync(keyPath).equals(keyBytes)).toBe(true);
        expect(readFileSync(pubPath, 'utf8')).toBe(keypair.publicKey);
        expect(result.createdKeys).toBe(false);
        expect(result.privateKey).toBe(keypair.privateKey);
        expect(JSON.parse(readFileSync(metadataPath, 'utf8')).email).toBe('setup@example.com');
        expect(run('read')).toBe('legacy_db');

    });

    it('should write only metadata when both key files exist', () => {

        const keypair = writeKey();

        writeFileSync(pubPath, keypair.publicKey, { mode: 0o644 });

        const keyBytes = readFileSync(keyPath);
        const result = JSON.parse(run('ensure'));

        expect(readFileSync(keyPath).equals(keyBytes)).toBe(true);
        expect(readFileSync(pubPath, 'utf8')).toBe(keypair.publicKey);
        expect(result.createdKeys).toBe(false);
        expect(result.createdMetadata).toBe(true);
        expect(JSON.parse(readFileSync(metadataPath, 'utf8')).publicKey).toBe(keypair.publicKey);
        expect(run('read')).toBe('legacy_db');

    });

    it('should leave a complete identity untouched', () => {

        const keypair = writeKey();
        const metadata = JSON.stringify({ ...EXISTING_METADATA, publicKey: keypair.publicKey }, null, 2);

        writeFileSync(pubPath, keypair.publicKey, { mode: 0o644 });
        writeFileSync(metadataPath, metadata);

        const keyBytes = readFileSync(keyPath);
        const result = JSON.parse(run('ensure'));

        expect(readFileSync(keyPath).equals(keyBytes)).toBe(true);
        expect(readFileSync(metadataPath, 'utf8')).toBe(metadata);
        expect(result.createdKeys).toBe(false);
        expect(result.createdMetadata).toBe(false);
        expect(result.identity.email).toBe('original@example.com');
        expect(run('read')).toBe('legacy_db');

    });

    it('should not rewrite metadata that exists beside a lone key', () => {

        const keypair = writeKey();
        const metadata = JSON.stringify({ ...EXISTING_METADATA, publicKey: keypair.publicKey }, null, 2);

        writeFileSync(metadataPath, metadata);

        const keyBytes = readFileSync(keyPath);

        run('ensure');

        expect(readFileSync(keyPath).equals(keyBytes)).toBe(true);
        expect(readFileSync(pubPath, 'utf8')).toBe(keypair.publicKey);
        expect(readFileSync(metadataPath, 'utf8')).toBe(metadata);

    });

    it('should generate a keypair only when no private key exists', () => {

        const result = JSON.parse(run('ensure'));

        expect(result.createdKeys).toBe(true);
        expect(result.createdMetadata).toBe(true);
        expect(readFileSync(keyPath, 'utf8')).toBe(result.privateKey);
        expect(existsSync(pubPath)).toBe(true);
        expect(JSON.parse(readFileSync(metadataPath, 'utf8')).name).toBe('Setup Person');

    });

    it('should refuse, not regenerate, when the key on disk cannot be loaded', () => {

        writeKey();
        chmodSync(keyPath, 0o644);

        const keyBytes = readFileSync(keyPath);
        const result = spawnSync('bun', ['run', FIXTURE, 'ensure', projectRoot], {
            encoding: 'utf-8',
            env: { ...process.env, HOME: fakeHome },
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('chmod 600');
        expect(readFileSync(keyPath).equals(keyBytes)).toBe(true);
        expect(existsSync(metadataPath)).toBe(false);

    });

});
