/**
 * Key storage tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm, readFile, stat, chmod, writeFile } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import {
    isValidKeyHex,
    getPrivateKeyPath,
    getPublicKeyPath,
    getNoormHomePath,
} from '../../../src/core/identity/storage.js';
import { generateKeyPair } from '../../../src/core/identity/crypto.js';

describe('identity: storage', () => {

    describe('isValidKeyHex', () => {

        it('should accept valid SPKI public key length (88 hex)', () => {

            const validKey = 'a'.repeat(88);

            expect(isValidKeyHex(validKey)).toBe(true);

        });

        it('should accept valid PKCS8 private key length (96 hex)', () => {

            const validKey = 'a'.repeat(96);

            expect(isValidKeyHex(validKey)).toBe(true);

        });

        it('should accept generated keypair keys', () => {

            const keypair = generateKeyPair();

            expect(isValidKeyHex(keypair.publicKey)).toBe(true);
            expect(isValidKeyHex(keypair.privateKey)).toBe(true);

        });

        it('should reject wrong length', () => {

            expect(isValidKeyHex('abc123')).toBe(false);
            expect(isValidKeyHex('a'.repeat(64))).toBe(false); // SHA-256 length
            expect(isValidKeyHex('a'.repeat(100))).toBe(false);

        });

        it('should reject non-hex characters', () => {

            expect(isValidKeyHex('g'.repeat(88))).toBe(false);
            expect(isValidKeyHex('G'.repeat(96))).toBe(false);

        });

        it('should accept mixed case hex', () => {

            const key = 'aAbBcCdDeEfF0123456789' + 'a'.repeat(66);

            expect(isValidKeyHex(key)).toBe(true);

        });

    });

    describe('path accessors', () => {

        it('should return noorm home in home directory', () => {

            const noormHome = getNoormHomePath();

            expect(noormHome).toBe(join(homedir(), '.noorm'));

        });

        it('should return private key path in noorm home', () => {

            const privateKeyPath = getPrivateKeyPath();
            const noormHome = getNoormHomePath();

            expect(privateKeyPath).toBe(join(noormHome, 'identity.key'));

        });

        it('should return public key path in noorm home', () => {

            const publicKeyPath = getPublicKeyPath();
            const noormHome = getNoormHomePath();

            expect(publicKeyPath).toBe(join(noormHome, 'identity.pub'));

        });

    });

});

describe('identity: storage (file operations)', () => {

    // Note: These tests test the actual file operations
    // We use a mock approach for the real paths since we don't want to
    // modify ~/.noorm during tests

    let tempDir: string;

    beforeEach(async () => {

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-test-'));

    });

    afterEach(async () => {

        await rm(tempDir, { recursive: true, force: true });

    });

    describe('key file format', () => {

        it('should write keys as plain hex strings', async () => {

            const keypair = generateKeyPair();
            const keyPath = join(tempDir, 'test.key');

            await writeFile(keyPath, keypair.privateKey, { encoding: 'utf8' });

            const content = await readFile(keyPath, { encoding: 'utf8' });

            expect(content).toBe(keypair.privateKey);
            expect(content).toMatch(/^[0-9a-f]+$/i);

        });

        it('should handle reading key with whitespace', async () => {

            const keypair = generateKeyPair();
            const keyPath = join(tempDir, 'test.key');

            // Write with extra whitespace
            await writeFile(keyPath, `  ${keypair.privateKey}  \n`, { encoding: 'utf8' });

            const content = (await readFile(keyPath, { encoding: 'utf8' })).trim();

            expect(content).toBe(keypair.privateKey);

        });

    });

    describe('file permissions', () => {

        it('should be able to set restrictive permissions', async () => {

            const keyPath = join(tempDir, 'test.key');
            await writeFile(keyPath, 'test', { mode: 0o600 });
            await chmod(keyPath, 0o600);

            const stats = await stat(keyPath);
            const mode = stats.mode & 0o777;

            expect(mode).toBe(0o600);

        });

    });

});
