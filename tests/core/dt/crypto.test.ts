/**
 * Passphrase-based encryption tests.
 *
 * Covers encryptWithPassphrase(), decryptWithPassphrase() round-trip,
 * wrong passphrase errors, tamper detection, and the passphrase floor.
 */
import { describe, it, expect } from 'bun:test';
import {
    createCipheriv,
    randomBytes,
    pbkdf2Sync,
} from 'node:crypto';

import {
    encryptWithPassphrase,
    decryptWithPassphrase,
    MIN_PASSPHRASE_LENGTH,
} from '../../../src/core/dt/crypto.js';
import type { DtEncryptedPayload } from '../../../src/core/dt/types.js';

describe('dt: crypto', () => {

    describe('encryptWithPassphrase / decryptWithPassphrase', () => {

        it('should round-trip a buffer', () => {

            const data = Buffer.from('Hello, World!', 'utf8');
            const passphrase = 'test-passphrase';

            const payload = encryptWithPassphrase(data, passphrase);
            const decrypted = decryptWithPassphrase(payload, passphrase);

            expect(decrypted.toString('utf8')).toBe('Hello, World!');

        });

        it('should round-trip binary data', () => {

            const data = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f]);
            const passphrase = 'binary-test-min12';

            const payload = encryptWithPassphrase(data, passphrase);
            const decrypted = decryptWithPassphrase(payload, passphrase);

            expect(decrypted.equals(data)).toBe(true);

        });

        it('should round-trip large data', () => {

            const data = Buffer.alloc(100_000, 'x');
            const passphrase = 'large-test-min12';

            const payload = encryptWithPassphrase(data, passphrase);
            const decrypted = decryptWithPassphrase(payload, passphrase);

            expect(decrypted.equals(data)).toBe(true);

        });

        it('should produce base64-encoded payload fields', () => {

            const data = Buffer.from('test');
            const payload = encryptWithPassphrase(data, 'pass-min-12chars');

            expect(typeof payload.salt).toBe('string');
            expect(typeof payload.iv).toBe('string');
            expect(typeof payload.authTag).toBe('string');
            expect(typeof payload.ciphertext).toBe('string');

            // Verify base64 decodes without error
            expect(() => Buffer.from(payload.salt, 'base64')).not.toThrow();
            expect(() => Buffer.from(payload.iv, 'base64')).not.toThrow();
            expect(() => Buffer.from(payload.authTag, 'base64')).not.toThrow();
            expect(() => Buffer.from(payload.ciphertext, 'base64')).not.toThrow();

        });

        it('should generate unique salt and IV per encryption', () => {

            const data = Buffer.from('same data');
            const passphrase = 'same-pass-min12';

            const p1 = encryptWithPassphrase(data, passphrase);
            const p2 = encryptWithPassphrase(data, passphrase);

            expect(p1.salt).not.toBe(p2.salt);
            expect(p1.iv).not.toBe(p2.iv);
            expect(p1.ciphertext).not.toBe(p2.ciphertext);

        });

    });

    describe('wrong passphrase', () => {

        it('should throw on wrong passphrase', () => {

            const data = Buffer.from('secret');
            const payload = encryptWithPassphrase(data, 'correct-pass');

            expect(() => {

                decryptWithPassphrase(payload, 'wrong-pass');

            }).toThrow();

        });

    });

    describe('tamper detection', () => {

        it('should detect tampered ciphertext', () => {

            const data = Buffer.from('secret');
            const payload = encryptWithPassphrase(data, 'pass-min-12chars');

            const tampered = {
                ...payload,
                ciphertext: 'ff' + payload.ciphertext.slice(2),
            };

            expect(() => {

                decryptWithPassphrase(tampered, 'pass-min-12chars');

            }).toThrow();

        });

        it('should detect tampered authTag', () => {

            const data = Buffer.from('secret');
            const payload = encryptWithPassphrase(data, 'pass-min-12chars');

            const tampered = {
                ...payload,
                authTag: 'ff' + payload.authTag.slice(2),
            };

            expect(() => {

                decryptWithPassphrase(tampered, 'pass-min-12chars');

            }).toThrow();

        });

        it('should detect tampered IV', () => {

            const data = Buffer.from('secret');
            const payload = encryptWithPassphrase(data, 'pass-min-12chars');

            const tampered = {
                ...payload,
                iv: Buffer.from('0000000000000000').toString('base64'),
            };

            expect(() => {

                decryptWithPassphrase(tampered, 'pass-min-12chars');

            }).toThrow();

        });

    });

    describe('MIN_PASSPHRASE_LENGTH floor', () => {

        it('should throw on encrypt with a 1-character passphrase', () => {

            const data = Buffer.from('secret');

            expect(() => {

                encryptWithPassphrase(data, 'a');

            }).toThrow(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);

        });

        it('should throw on encrypt with an 11-character passphrase', () => {

            const data = Buffer.from('secret');
            const passphrase = 'a'.repeat(MIN_PASSPHRASE_LENGTH - 1);

            expect(() => {

                encryptWithPassphrase(data, passphrase);

            }).toThrow(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);

        });

        it('should succeed on encrypt with a 12-character passphrase', () => {

            const data = Buffer.from('secret');
            const passphrase = 'a'.repeat(MIN_PASSPHRASE_LENGTH);

            expect(() => {

                encryptWithPassphrase(data, passphrase);

            }).not.toThrow();

        });

        it('should decrypt a legacy payload encrypted pre-floor with a short passphrase', () => {

            // Builds the payload the same way encryptWithPassphrase does,
            // bypassing its floor check, to prove decrypt still opens
            // archives from older versions encrypted with short passphrases.
            const passphrase = 'short';
            const data = Buffer.from('legacy secret');

            const salt = randomBytes(32);
            const iv = randomBytes(16);
            const key = pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');

            const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
            const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
            const authTag = cipher.getAuthTag();

            const legacyPayload: DtEncryptedPayload = {
                salt: salt.toString('base64'),
                iv: iv.toString('base64'),
                authTag: authTag.toString('base64'),
                ciphertext: ciphertext.toString('base64'),
            };

            const decrypted = decryptWithPassphrase(legacyPayload, passphrase);

            expect(decrypted.toString('utf8')).toBe('legacy secret');

        });

    });

});
