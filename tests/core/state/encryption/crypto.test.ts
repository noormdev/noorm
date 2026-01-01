/**
 * State encryption crypto tests.
 *
 * Tests AES-256-GCM encryption/decryption for state persistence.
 * Validates security properties: random IVs, auth tags, tampering detection.
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../../../src/core/identity/crypto.js';
import { encrypt, decrypt } from '../../../../src/core/state/encryption/crypto.js';
import type { EncryptedPayload } from '../../../../src/core/state/types.js';

describe('encryption: crypto', () => {

    describe('encrypt/decrypt roundtrip', () => {

        it('should encrypt and decrypt short text', () => {

            const keypair = generateKeyPair();
            const plaintext = 'Hello, World!';

            const payload = encrypt(plaintext, keypair.privateKey);
            const decrypted = decrypt(payload, keypair.privateKey);

            expect(decrypted).toBe(plaintext);

        });

        it('should encrypt and decrypt long text', () => {

            const keypair = generateKeyPair();
            // Generate long text (~10KB)
            const plaintext = 'Lorem ipsum dolor sit amet. '.repeat(400);

            const payload = encrypt(plaintext, keypair.privateKey);
            const decrypted = decrypt(payload, keypair.privateKey);

            expect(decrypted).toBe(plaintext);

        });

        it('should encrypt and decrypt JSON objects', () => {

            const keypair = generateKeyPair();
            const data = {
                version: '1.0.0',
                identity: null,
                knownUsers: {},
                activeConfig: 'test-db',
                configs: {
                    'test-db': {
                        name: 'test-db',
                        dialect: 'postgres',
                        connection: {
                            host: 'localhost',
                            port: 5432,
                            database: 'testdb',
                            user: 'testuser',
                            password: 'secret123',
                        },
                    },
                },
                secrets: {
                    'test-db': {
                        API_KEY: 'super-secret',
                        AWS_SECRET: 'another-secret',
                    },
                },
                globalSecrets: {
                    MASTER_KEY: 'global-secret',
                },
            };

            const plaintext = JSON.stringify(data);
            const payload = encrypt(plaintext, keypair.privateKey);
            const decrypted = decrypt(payload, keypair.privateKey);
            const result = JSON.parse(decrypted);

            expect(result).toEqual(data);

        });

        it('should produce different ciphertext for same plaintext (random IV)', () => {

            const keypair = generateKeyPair();
            const plaintext = 'Same message';

            const payload1 = encrypt(plaintext, keypair.privateKey);
            const payload2 = encrypt(plaintext, keypair.privateKey);

            // Different IVs ensure different ciphertexts
            expect(payload1.iv).not.toBe(payload2.iv);
            expect(payload1.ciphertext).not.toBe(payload2.ciphertext);

            // Both should decrypt to same plaintext
            expect(decrypt(payload1, keypair.privateKey)).toBe(plaintext);
            expect(decrypt(payload2, keypair.privateKey)).toBe(plaintext);

        });

    });

    describe('decrypt error handling', () => {

        it('should throw for unsupported algorithm', () => {

            const keypair = generateKeyPair();
            const payload: EncryptedPayload = {
                algorithm: 'aes-128-cbc' as any, // Invalid algorithm
                iv: 'dmFsaWRpdnZhbGlkaXY=', // valid base64
                authTag: 'dmFsaWR0YWd2YWxpZHRhZw==', // valid base64
                ciphertext: 'dmFsaWRjaXBoZXJ0ZXh0', // valid base64
            };

            expect(() => {

                decrypt(payload, keypair.privateKey);

            }).toThrow(/unsupported algorithm/i);

        });

        it('should throw for wrong key (auth tag failure)', () => {

            const keypair1 = generateKeyPair();
            const keypair2 = generateKeyPair();

            const plaintext = 'secret message';
            const payload = encrypt(plaintext, keypair1.privateKey);

            // Try to decrypt with wrong key
            expect(() => {

                decrypt(payload, keypair2.privateKey);

            }).toThrow();

        });

        it('should throw for tampered ciphertext', () => {

            const keypair = generateKeyPair();
            const plaintext = 'original message';
            const payload = encrypt(plaintext, keypair.privateKey);

            // Tamper with ciphertext by flipping first two hex chars
            const cipherBuffer = Buffer.from(payload.ciphertext, 'base64');
            cipherBuffer[0] ^= 0xFF; // Flip all bits in first byte
            const tampered: EncryptedPayload = {
                ...payload,
                ciphertext: cipherBuffer.toString('base64'),
            };

            // Auth tag should detect tampering
            expect(() => {

                decrypt(tampered, keypair.privateKey);

            }).toThrow();

        });

        it('should throw for tampered auth tag', () => {

            const keypair = generateKeyPair();
            const plaintext = 'original message';
            const payload = encrypt(plaintext, keypair.privateKey);

            // Tamper with auth tag
            const authBuffer = Buffer.from(payload.authTag, 'base64');
            authBuffer[0] ^= 0xFF; // Flip all bits in first byte
            const tampered: EncryptedPayload = {
                ...payload,
                authTag: authBuffer.toString('base64'),
            };

            // Modified auth tag should fail verification
            expect(() => {

                decrypt(tampered, keypair.privateKey);

            }).toThrow();

        });

        it('should throw for corrupted IV', () => {

            const keypair = generateKeyPair();
            const plaintext = 'original message';
            const payload = encrypt(plaintext, keypair.privateKey);

            // Corrupt IV by changing its value
            const ivBuffer = Buffer.from(payload.iv, 'base64');
            ivBuffer[0] ^= 0xFF; // Flip all bits in first byte
            const corrupted: EncryptedPayload = {
                ...payload,
                iv: ivBuffer.toString('base64'),
            };

            // Wrong IV should produce wrong plaintext or fail auth
            expect(() => {

                decrypt(corrupted, keypair.privateKey);

            }).toThrow();

        });

    });

    describe('security properties', () => {

        it('should use 16-byte IV (base64 length check)', () => {

            const keypair = generateKeyPair();
            const plaintext = 'test message';

            const payload = encrypt(plaintext, keypair.privateKey);

            // 16 bytes = 24 base64 chars (including padding)
            const ivBuffer = Buffer.from(payload.iv, 'base64');
            expect(ivBuffer.length).toBe(16);

        });

        it('should use 16-byte auth tag', () => {

            const keypair = generateKeyPair();
            const plaintext = 'test message';

            const payload = encrypt(plaintext, keypair.privateKey);

            // 16 bytes auth tag
            const authBuffer = Buffer.from(payload.authTag, 'base64');
            expect(authBuffer.length).toBe(16);

        });

        it('should use aes-256-gcm algorithm', () => {

            const keypair = generateKeyPair();
            const plaintext = 'test message';

            const payload = encrypt(plaintext, keypair.privateKey);

            expect(payload.algorithm).toBe('aes-256-gcm');

        });

        it('should derive same key from same private key', () => {

            const keypair = generateKeyPair();
            const plaintext = 'consistent encryption';

            // Encrypt twice with same key
            const payload1 = encrypt(plaintext, keypair.privateKey);
            const payload2 = encrypt(plaintext, keypair.privateKey);

            // Both should decrypt successfully (proves same derived key)
            expect(decrypt(payload1, keypair.privateKey)).toBe(plaintext);
            expect(decrypt(payload2, keypair.privateKey)).toBe(plaintext);

        });

        it('should handle empty string', () => {

            const keypair = generateKeyPair();
            const plaintext = '';

            const payload = encrypt(plaintext, keypair.privateKey);
            const decrypted = decrypt(payload, keypair.privateKey);

            expect(decrypted).toBe(plaintext);

        });

        it('should handle unicode characters', () => {

            const keypair = generateKeyPair();
            const plaintext = 'Hello 世界 🌍 Здравствуй مرحبا';

            const payload = encrypt(plaintext, keypair.privateKey);
            const decrypted = decrypt(payload, keypair.privateKey);

            expect(decrypted).toBe(plaintext);

        });

    });

});
