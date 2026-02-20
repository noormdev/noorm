/**
 * Passphrase-based encryption tests.
 *
 * Covers encryptWithPassphrase(), decryptWithPassphrase() round-trip,
 * wrong passphrase errors, and tamper detection.
 */
import { describe, it, expect } from 'bun:test';
import {
    encryptWithPassphrase,
    decryptWithPassphrase,
} from '../../../src/core/dt/crypto.js';

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
            const passphrase = 'binary-test';

            const payload = encryptWithPassphrase(data, passphrase);
            const decrypted = decryptWithPassphrase(payload, passphrase);

            expect(decrypted.equals(data)).toBe(true);

        });

        it('should round-trip large data', () => {

            const data = Buffer.alloc(100_000, 'x');
            const passphrase = 'large-test';

            const payload = encryptWithPassphrase(data, passphrase);
            const decrypted = decryptWithPassphrase(payload, passphrase);

            expect(decrypted.equals(data)).toBe(true);

        });

        it('should produce base64-encoded payload fields', () => {

            const data = Buffer.from('test');
            const payload = encryptWithPassphrase(data, 'pass');

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
            const passphrase = 'same-pass';

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
            const payload = encryptWithPassphrase(data, 'pass');

            const tampered = {
                ...payload,
                ciphertext: 'ff' + payload.ciphertext.slice(2),
            };

            expect(() => {

                decryptWithPassphrase(tampered, 'pass');

            }).toThrow();

        });

        it('should detect tampered authTag', () => {

            const data = Buffer.from('secret');
            const payload = encryptWithPassphrase(data, 'pass');

            const tampered = {
                ...payload,
                authTag: 'ff' + payload.authTag.slice(2),
            };

            expect(() => {

                decryptWithPassphrase(tampered, 'pass');

            }).toThrow();

        });

        it('should detect tampered IV', () => {

            const data = Buffer.from('secret');
            const payload = encryptWithPassphrase(data, 'pass');

            const tampered = {
                ...payload,
                iv: Buffer.from('0000000000000000').toString('base64'),
            };

            expect(() => {

                decryptWithPassphrase(tampered, 'pass');

            }).toThrow();

        });

    });

});
