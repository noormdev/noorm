/**
 * AES-256-GCM encryption/decryption.
 *
 * Provides authenticated encryption - both confidentiality and integrity.
 * Any tampering with the ciphertext will be detected.
 *
 * Encryption key is derived from the user's private key using HKDF.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { EncryptedPayload } from '../types.js';
import { deriveStateKey } from '../../identity/crypto.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt a string using the private key.
 *
 * Uses HKDF to derive an encryption key from the private key,
 * then encrypts with AES-256-GCM.
 *
 * @example
 * ```typescript
 * const payload = encrypt('{"configs": {}}', privateKey)
 * // {
 * //   algorithm: 'aes-256-gcm',
 * //   iv: 'base64...',
 * //   authTag: 'base64...',
 * //   ciphertext: 'base64...'
 * // }
 * ```
 */
export function encrypt(plaintext: string, privateKey: string): EncryptedPayload {

    const key = deriveStateKey(privateKey);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    const authTag = cipher.getAuthTag();

    return {
        algorithm: ALGORITHM,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
    };

}

/**
 * Decrypt an encrypted payload and return the plaintext.
 *
 * Throws if decryption fails (wrong key, tampered data, etc.)
 *
 * @example
 * ```typescript
 * const plaintext = decrypt(payload, privateKey)
 * ```
 */
export function decrypt(payload: EncryptedPayload, privateKey: string): string {

    if (payload.algorithm !== ALGORITHM) {

        throw new Error(`Unsupported algorithm: ${payload.algorithm}`);

    }

    const key = deriveStateKey(privateKey);
    const iv = Buffer.from(payload.iv, 'base64');
    const authTag = Buffer.from(payload.authTag, 'base64');
    const ciphertext = Buffer.from(payload.ciphertext, 'base64');

    const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return plaintext.toString('utf8');

}
