/**
 * Vault key crypto tests.
 *
 * Pins `generateVaultKey`/`encryptVaultKey`/`decryptVaultKey`/`encryptSecret`/`decryptSecret`
 * (`src/core/vault/key.ts`) directly — pure `node:crypto` wrapping, no DB dependency.
 * The third-identity-decrypt-fails test is the ticket's named core security property:
 * a vault key encrypted for one recipient must never be recoverable by any other keypair.
 */
import { describe, it, expect } from 'bun:test';

import {
    generateVaultKey,
    encryptVaultKey,
    decryptVaultKey,
    encryptSecret,
    decryptSecret,
} from '../../../src/core/vault/key.js';
import { generateKeyPair } from '../../../src/core/identity/index.js';
import type { EncryptedVaultKey } from '../../../src/core/vault/types.js';

/**
 * Flip one hex character in a hex string, at a position guaranteed to change
 * the resulting byte (never flips to the same nibble).
 */
function flipOneHexChar(hex: string): string {

    const chars = hex.split('');
    const targetIndex = 0;
    const current = chars[targetIndex];
    const flipped = current === '0' ? '1' : '0';

    chars[targetIndex] = flipped;

    return chars.join('');

}

describe('vault: generateVaultKey', () => {

    it('should return a 32-byte Buffer', () => {

        const key = generateVaultKey();

        expect(key).toBeInstanceOf(Buffer);
        expect(key.length).toBe(32);

    });

    it('should produce different bytes on each call (not a fixed/zero key)', () => {

        const first = generateVaultKey();
        const second = generateVaultKey();

        expect(first.equals(second)).toBe(false);
        expect(first.equals(Buffer.alloc(32))).toBe(false);

    });

});

describe('vault: encryptVaultKey / decryptVaultKey round trip', () => {

    it('should decrypt to the original vault key using the recipient\'s own private key', () => {

        const identityA = generateKeyPair();
        const vaultKey = generateVaultKey();

        const encrypted = encryptVaultKey(vaultKey, identityA.publicKey);
        const decrypted = decryptVaultKey(encrypted, identityA.privateKey);

        expect(decrypted).toBeInstanceOf(Buffer);
        expect(decrypted?.equals(vaultKey)).toBe(true);

    });

    it('should return null (not throw) when a third, unrelated identity attempts decryption', () => {

        const identityB = generateKeyPair();
        const identityC = generateKeyPair();
        const vaultKey = generateVaultKey();

        const encrypted = encryptVaultKey(vaultKey, identityB.publicKey);

        const decrypted = decryptVaultKey(encrypted, identityC.privateKey);

        expect(decrypted).toBeNull();

    });

    it('should not leak any bytes of the original key to a third identity\'s failed decryption', () => {

        const identityB = generateKeyPair();
        const identityC = generateKeyPair();
        const vaultKey = generateVaultKey();

        const encrypted = encryptVaultKey(vaultKey, identityB.publicKey);

        // decryptVaultKey returns null on auth failure — assert directly there's
        // no partial-plaintext leak path (e.g. returning update() bytes before
        // the final()/authTag check throws).
        const decrypted = decryptVaultKey(encrypted, identityC.privateKey);

        expect(decrypted).toBeNull();
        expect(decrypted).not.toEqual(vaultKey);

    });

    it('should return null when the authTag is tampered (one hex character flipped)', () => {

        const identityA = generateKeyPair();
        const vaultKey = generateVaultKey();

        const encrypted = encryptVaultKey(vaultKey, identityA.publicKey);
        const tampered: EncryptedVaultKey = {
            ...encrypted,
            authTag: flipOneHexChar(encrypted.authTag),
        };

        const decrypted = decryptVaultKey(tampered, identityA.privateKey);

        expect(decrypted).toBeNull();

    });

    it('should return null when the ciphertext is tampered (one hex character flipped)', () => {

        const identityA = generateKeyPair();
        const vaultKey = generateVaultKey();

        const encrypted = encryptVaultKey(vaultKey, identityA.publicKey);
        const tampered: EncryptedVaultKey = {
            ...encrypted,
            ciphertext: flipOneHexChar(encrypted.ciphertext),
        };

        const decrypted = decryptVaultKey(tampered, identityA.privateKey);

        expect(decrypted).toBeNull();

    });

});

describe('vault: encryptSecret / decryptSecret round trip', () => {

    it('should decrypt to the original plaintext using the same vault key', () => {

        const vaultKey = generateVaultKey();
        const plaintext = 'sk-live-super-secret-value';

        const encrypted = encryptSecret(plaintext, vaultKey);
        const decrypted = decryptSecret(encrypted, vaultKey);

        expect(decrypted).toBe(plaintext);

    });

    it('should return null when decrypted with the wrong vault key', () => {

        const vaultKey = generateVaultKey();
        const wrongKey = generateVaultKey();
        const plaintext = 'sk-live-super-secret-value';

        const encrypted = encryptSecret(plaintext, vaultKey);
        const decrypted = decryptSecret(encrypted, wrongKey);

        expect(decrypted).toBeNull();

    });

    it('should return null when the ciphertext is tampered (one hex character flipped)', () => {

        const vaultKey = generateVaultKey();
        const plaintext = 'sk-live-super-secret-value';

        const encrypted = encryptSecret(plaintext, vaultKey);
        const tampered = {
            ...encrypted,
            ciphertext: flipOneHexChar(encrypted.ciphertext),
        };

        const decrypted = decryptSecret(tampered, vaultKey);

        expect(decrypted).toBeNull();

    });

});
