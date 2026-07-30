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
import { isValidKeyHex } from '../../identity/storage.js';

const ALGORITHM = 'aes-256-gcm';

/**
 * Non-standard: NIST SP 800-38D specifies a 12-byte GCM nonce, which uses
 * the direct J0 construction. 16 bytes forces the GHASH-based one instead.
 * It is not a weakness — a random 16-byte nonce collides less often than a
 * random 12-byte one — but it is a deliberate deviation, and the `kdf`
 * field below is what makes it changeable without bricking existing files.
 */
const IV_LENGTH = 16;

const AUTH_TAG_LENGTH = 16;

/** Key derivation stamped into every payload this build writes. */
const KDF = 'hkdf-sha256';

/**
 * Reject key material that cannot be what it claims to be.
 *
 * `Buffer.from(str, 'hex')` never throws: it stops at the first invalid
 * pair and truncates odd lengths. Every non-hex string therefore collapsed
 * to the same zero-length HKDF input, deriving an AES key that is a
 * published constant — state encrypted under it is readable by anyone.
 * The real fix belongs in `deriveStateKey`; this is the consuming side
 * refusing to be the one that reaches it.
 */
function assertUsableKey(privateKey: string): void {

    if (!isValidKeyHex(privateKey)) {

        // Deliberately says nothing about the value itself — this message
        // reaches logs and --json output.
        throw new Error(
            'Invalid private key: expected a hex-encoded X25519 key. ' +
            'The key file may be corrupted or partially written. Re-run: noorm init',
        );

    }

}

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

    assertUsableKey(privateKey);

    const key = deriveStateKey(privateKey);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    const authTag = cipher.getAuthTag();

    return {
        algorithm: ALGORITHM,
        kdf: KDF,
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

    // Absent means this payload predates the field, which can only be
    // hkdf-sha256 — the sole derivation ever shipped.
    if (payload.kdf !== undefined && payload.kdf !== KDF) {

        throw new Error(
            `Unsupported key derivation: ${payload.kdf}. This state file was written by a newer noorm.`,
        );

    }

    assertUsableKey(privateKey);

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
