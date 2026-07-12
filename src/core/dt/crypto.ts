/**
 * Passphrase-based encryption for .dtzx files.
 *
 * Self-contained AES-256-GCM encryption using PBKDF2 key derivation.
 * Independent of the identity system — uses a user-provided passphrase.
 *
 * @example
 * ```typescript
 * import { encryptWithPassphrase, decryptWithPassphrase } from './crypto.js';
 *
 * const payload = encryptWithPassphrase(data, 'my-secret');
 * const decrypted = decryptWithPassphrase(payload, 'my-secret');
 * ```
 */
import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
    pbkdf2Sync,
} from 'node:crypto';

import type { DtEncryptedPayload } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha256';

/**
 * Minimum passphrase length enforced on encryption.
 *
 * Not enforced on decryption — a floor there would brick .dtzx archives
 * encrypted by older versions with shorter passphrases; a wrong passphrase
 * already fails via GCM auth tag verification.
 */
export const MIN_PASSPHRASE_LENGTH = 12;

/**
 * Encrypt data with a passphrase using AES-256-GCM.
 *
 * Derives a key from the passphrase using PBKDF2 with a random salt.
 * Each call generates a new salt and IV for unique ciphertexts.
 *
 * @param data - Data to encrypt
 * @param passphrase - User-provided encryption passphrase, at least MIN_PASSPHRASE_LENGTH characters
 * @returns Encrypted payload with salt, IV, authTag, and ciphertext
 * @throws If passphrase is shorter than MIN_PASSPHRASE_LENGTH
 *
 * @example
 * ```typescript
 * const compressed = gzipSync(fileContent);
 * const payload = encryptWithPassphrase(compressed, 'my-passphrase');
 * ```
 */
export function encryptWithPassphrase(data: Buffer, passphrase: string): DtEncryptedPayload {

    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {

        throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);

    }

    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);

    const key = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);

    const cipher = createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
    };

}

/**
 * Decrypt a payload using a passphrase.
 *
 * Derives the same key using PBKDF2 with the stored salt,
 * then decrypts and verifies with AES-256-GCM.
 *
 * @param payload - Encrypted payload from encryptWithPassphrase
 * @param passphrase - Same passphrase used for encryption
 * @returns Decrypted data buffer
 * @throws If passphrase is wrong or data is tampered
 *
 * @example
 * ```typescript
 * const decrypted = decryptWithPassphrase(payload, 'my-passphrase');
 * const content = gunzipSync(decrypted);
 * ```
 */
export function decryptWithPassphrase(payload: DtEncryptedPayload, passphrase: string): Buffer {

    const salt = Buffer.from(payload.salt, 'base64');
    const iv = Buffer.from(payload.iv, 'base64');
    const authTag = Buffer.from(payload.authTag, 'base64');
    const ciphertext = Buffer.from(payload.ciphertext, 'base64');

    const key = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);

    const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return decrypted;

}
