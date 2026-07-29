/**
 * Cryptographic identity tests.
 */
import { describe, it, expect } from 'bun:test';
import { attemptSync } from '@logosdx/utils';
import {
    generateKeyPair,
    encryptForRecipient,
    decryptWithPrivateKey,
    deriveStateKey,
    encryptState,
    decryptState,
} from '../../../src/core/identity/crypto.js';

/**
 * Flips the first byte of a hex ciphertext so the result is always different
 * from the input.
 *
 * Assigning a fixed byte instead (`'ff' + ct.slice(2)`) is a no-op the 1-in-256
 * times the ciphertext already starts with that value, leaving the payload
 * untouched — decryption then succeeds and the tamper-detection assertion fails
 * for reasons that have nothing to do with the code under test.
 */
function tamperFirstByte(ciphertext: string) {

    const flipped = (parseInt(ciphertext.slice(0, 2), 16) ^ 0xff)
        .toString(16)
        .padStart(2, '0');

    return flipped + ciphertext.slice(2);

}

describe('identity: crypto', () => {

    describe('generateKeyPair', () => {

        it('should generate a valid keypair', () => {

            const keypair = generateKeyPair();

            expect(keypair.publicKey).toBeTruthy();
            expect(keypair.privateKey).toBeTruthy();
            expect(keypair.publicKey).not.toBe(keypair.privateKey);

        });

        it('should generate hex-encoded keys', () => {

            const keypair = generateKeyPair();

            // Keys should be hex strings
            expect(keypair.publicKey).toMatch(/^[0-9a-f]+$/i);
            expect(keypair.privateKey).toMatch(/^[0-9a-f]+$/i);

        });

        it('should generate unique keypairs', () => {

            const keypair1 = generateKeyPair();
            const keypair2 = generateKeyPair();

            expect(keypair1.publicKey).not.toBe(keypair2.publicKey);
            expect(keypair1.privateKey).not.toBe(keypair2.privateKey);

        });

        it('should generate DER-encoded keys with expected lengths', () => {

            const keypair = generateKeyPair();

            // SPKI public key: 44 bytes = 88 hex chars
            expect(keypair.publicKey.length).toBe(88);

            // PKCS8 private key: 48 bytes = 96 hex chars
            expect(keypair.privateKey.length).toBe(96);

        });

    });

    describe('encryptForRecipient / decryptWithPrivateKey', () => {

        it('should encrypt and decrypt a message', () => {

            const recipient = generateKeyPair();
            const plaintext = 'Hello, World!';

            const payload = encryptForRecipient(
                plaintext,
                recipient.publicKey,
                'sender@example.com',
                'recipient@example.com',
            );

            const decrypted = decryptWithPrivateKey(payload, recipient.privateKey);

            expect(decrypted).toBe(plaintext);

        });

        it('should encrypt and decrypt JSON data', () => {

            const recipient = generateKeyPair();
            const data = { config: 'test', secrets: { API_KEY: 'secret123' } };
            const plaintext = JSON.stringify(data);

            const payload = encryptForRecipient(
                plaintext,
                recipient.publicKey,
                'sender@example.com',
                'recipient@example.com',
            );

            const decrypted = decryptWithPrivateKey(payload, recipient.privateKey);
            const result = JSON.parse(decrypted);

            expect(result).toEqual(data);

        });

        it('should include metadata in payload', () => {

            const recipient = generateKeyPair();

            const payload = encryptForRecipient(
                'test',
                recipient.publicKey,
                'alice@example.com',
                'bob@example.com',
            );

            expect(payload.version).toBe(1);
            expect(payload.sender).toBe('alice@example.com');
            expect(payload.recipient).toBe('bob@example.com');
            expect(payload.ephemeralPubKey).toBeTruthy();
            expect(payload.iv).toBeTruthy();
            expect(payload.authTag).toBeTruthy();
            expect(payload.ciphertext).toBeTruthy();

        });

        it('should use different ephemeral keys for each encryption', () => {

            const recipient = generateKeyPair();

            const payload1 = encryptForRecipient(
                'test',
                recipient.publicKey,
                'sender@example.com',
                'recipient@example.com',
            );

            const payload2 = encryptForRecipient(
                'test',
                recipient.publicKey,
                'sender@example.com',
                'recipient@example.com',
            );

            expect(payload1.ephemeralPubKey).not.toBe(payload2.ephemeralPubKey);
            expect(payload1.ciphertext).not.toBe(payload2.ciphertext);

        });

        it('should fail decryption with wrong private key', () => {

            const recipient = generateKeyPair();
            const wrongKey = generateKeyPair();

            const payload = encryptForRecipient(
                'secret message',
                recipient.publicKey,
                'sender@example.com',
                'recipient@example.com',
            );

            expect(() => {

                decryptWithPrivateKey(payload, wrongKey.privateKey);

            }).toThrow();

        });

        it('should fail decryption if ciphertext is tampered', () => {

            const recipient = generateKeyPair();

            const payload = encryptForRecipient(
                'secret message',
                recipient.publicKey,
                'sender@example.com',
                'recipient@example.com',
            );

            const tampered = { ...payload, ciphertext: tamperFirstByte(payload.ciphertext) };

            expect(() => {

                decryptWithPrivateKey(tampered, recipient.privateKey);

            }).toThrow();

        });

        it('should reject unsupported payload versions', () => {

            const recipient = generateKeyPair();

            const payload = encryptForRecipient(
                'test',
                recipient.publicKey,
                'sender@example.com',
                'recipient@example.com',
            );

            const badVersion = { ...payload, version: 99 };

            expect(() => {

                decryptWithPrivateKey(badVersion, recipient.privateKey);

            }).toThrow(/unsupported payload version/i);

        });

    });

    describe('deriveStateKey', () => {

        it('should derive a 32-byte key', () => {

            const keypair = generateKeyPair();
            const key = deriveStateKey(keypair.privateKey);

            expect(key.length).toBe(32);

        });

        it('should derive same key from same private key', () => {

            const keypair = generateKeyPair();
            const key1 = deriveStateKey(keypair.privateKey);
            const key2 = deriveStateKey(keypair.privateKey);

            expect(key1.equals(key2)).toBe(true);

        });

        it('should derive different keys from different private keys', () => {

            const keypair1 = generateKeyPair();
            const keypair2 = generateKeyPair();

            const key1 = deriveStateKey(keypair1.privateKey);
            const key2 = deriveStateKey(keypair2.privateKey);

            expect(key1.equals(key2)).toBe(false);

        });

        /**
         * `Buffer.from(str, 'hex')` never throws — it stops at the first invalid
         * pair and truncates odd lengths. Without a guard, every malformed key
         * collapses to the same zero-length HKDF input, so the derived AES key is
         * a constant anyone can recompute from the source. The assertion is that
         * derivation REFUSES, not that the constants differ.
         */
        it('should reject non-hex key material rather than deriving a constant key', () => {

            for (const badKey of ['', 'not-hex-at-all', 'zz', 'corrupted-not-hex-at-all']) {

                const [key, err] = attemptSync(() => deriveStateKey(badKey));

                expect(err).toBeInstanceOf(Error);
                expect(key).toBeNull();

            }

        });

        it('should reject a truncated private key', () => {

            const { privateKey } = generateKeyPair();

            const [key, err] = attemptSync(() => deriveStateKey(privateKey.slice(0, 40)));

            expect(err).toBeInstanceOf(Error);
            expect(key).toBeNull();

        });

        it('should never derive the same key from two different malformed inputs', () => {

            const [k1] = attemptSync(() => deriveStateKey('zz'));
            const [k2] = attemptSync(() => deriveStateKey('also-not-hex'));

            // Both must be null (rejected). If either derived a buffer, the
            // degenerate-IKM collapse is back.
            expect(k1).toBeNull();
            expect(k2).toBeNull();

        });

    });

    describe('encryptState / decryptState', () => {

        it('should encrypt and decrypt state', () => {

            const keypair = generateKeyPair();
            const state = JSON.stringify({
                version: '1.0.0',
                configs: {},
                secrets: {},
            });

            const encrypted = encryptState(state, keypair.privateKey);
            const decrypted = decryptState(encrypted, keypair.privateKey);

            expect(decrypted).toBe(state);

        });

        it('should produce different ciphertexts for same plaintext', () => {

            const keypair = generateKeyPair();
            const state = 'test state';

            const encrypted1 = encryptState(state, keypair.privateKey);
            const encrypted2 = encryptState(state, keypair.privateKey);

            // Different IVs mean different ciphertexts
            expect(encrypted1.iv).not.toBe(encrypted2.iv);
            expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);

        });

        it('should fail decryption with wrong key', () => {

            const keypair1 = generateKeyPair();
            const keypair2 = generateKeyPair();

            const encrypted = encryptState('secret', keypair1.privateKey);

            expect(() => {

                decryptState(encrypted, keypair2.privateKey);

            }).toThrow();

        });

        it('should detect tampering', () => {

            const keypair = generateKeyPair();
            const encrypted = encryptState('secret', keypair.privateKey);

            const tampered = { ...encrypted, ciphertext: tamperFirstByte(encrypted.ciphertext) };

            expect(() => {

                decryptState(tampered, keypair.privateKey);

            }).toThrow();

        });

        /**
         * Reachability proof for the degenerate-key defect: a corrupted
         * `identity.key` reaches `encryptState` directly via StateManager, so
         * state written under it would be readable by anyone. Encryption must
         * refuse rather than produce a decryptable-by-all artifact.
         */
        it('should refuse to encrypt state under malformed key material', () => {

            const [encrypted, err] = attemptSync(() =>
                encryptState('{"secrets":{"prod":{"STRIPE_KEY":"sk_live_x"}}}', 'corrupted-not-hex'),
            );

            expect(err).toBeInstanceOf(Error);
            expect(encrypted).toBeNull();

        });

        it('should refuse to decrypt state under malformed key material', () => {

            const keypair = generateKeyPair();
            const encrypted = encryptState('secret', keypair.privateKey);

            const [plaintext, err] = attemptSync(() => decryptState(encrypted, 'zz'));

            expect(err).toBeInstanceOf(Error);
            expect(plaintext).toBeNull();

        });

    });

});
