/**
 * Vault key management.
 *
 * Generates, encrypts, and decrypts the vault key.
 * The vault key is a 256-bit symmetric key used to encrypt vault secrets.
 * Each user's copy is encrypted with their public key.
 */
import {
    randomBytes,
    createCipheriv,
    createDecipheriv,
    createPrivateKey,
    createPublicKey,
    diffieHellman,
    generateKeyPairSync,
    hkdfSync,
} from 'crypto';

import { attemptSync } from '@logosdx/utils';

import type { EncryptedVaultKey } from './types.js';

/**
 * Generate a new 256-bit vault key.
 *
 * Called once during vault initialization by the first user.
 *
 * @example
 * ```typescript
 * const vaultKey = generateVaultKey();
 * // vaultKey is 32 bytes of cryptographically secure random data
 * ```
 */
export function generateVaultKey(): Buffer {

    return randomBytes(32);

}

/**
 * Derive shared secret from private key and public key using X25519 ECDH.
 */
function deriveSharedSecret(privateKeyHex: string, publicKeyHex: string): Buffer {

    const privateKey = createPrivateKey({
        key: Buffer.from(privateKeyHex, 'hex'),
        format: 'der',
        type: 'pkcs8',
    });

    const publicKey = createPublicKey({
        key: Buffer.from(publicKeyHex, 'hex'),
        format: 'der',
        type: 'spki',
    });

    return diffieHellman({
        privateKey,
        publicKey,
    });

}

/**
 * Derive encryption key from shared secret using HKDF.
 */
function deriveEncryptionKey(sharedSecret: Buffer, info: string): Buffer {

    return Buffer.from(
        hkdfSync(
            'sha256',
            sharedSecret,
            Buffer.alloc(0),
            info,
            32,
        ),
    );

}

/**
 * Encrypt vault key for a recipient using their public key.
 *
 * Uses the ephemeral keypair pattern:
 * 1. Generate ephemeral X25519 keypair
 * 2. ECDH with recipient's public key
 * 3. HKDF to derive encryption key
 * 4. AES-256-GCM encryption
 *
 * @param vaultKey - The 32-byte vault key to encrypt
 * @param recipientPubKey - Recipient's X25519 public key (hex)
 *
 * @example
 * ```typescript
 * const encrypted = encryptVaultKey(vaultKey, userPublicKey);
 * // Store encrypted in user's encrypted_vault_key column
 * ```
 */
export function encryptVaultKey(vaultKey: Buffer, recipientPubKey: string): EncryptedVaultKey {

    // Generate ephemeral keypair for this encryption
    const { publicKey, privateKey } = generateKeyPairSync('x25519', {
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    const ephemeralPrivateHex = privateKey.toString('hex');
    const ephemeralPublicHex = publicKey.toString('hex');

    // Derive shared secret via ECDH
    const sharedSecret = deriveSharedSecret(ephemeralPrivateHex, recipientPubKey);

    // Derive encryption key
    const encKey = deriveEncryptionKey(sharedSecret, 'noorm-vault-key');

    // Generate random IV
    const iv = randomBytes(16);

    // Encrypt with AES-256-GCM
    const cipher = createCipheriv('aes-256-gcm', encKey, iv);
    const ciphertext = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
        ephemeralPubKey: ephemeralPublicHex,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        ciphertext: ciphertext.toString('hex'),
    };

}

/**
 * Decrypt vault key using the user's private key.
 *
 * Reverses the ephemeral keypair pattern:
 * 1. ECDH with ephemeral public key and user's private key
 * 2. HKDF to derive decryption key
 * 3. AES-256-GCM decryption
 *
 * @param encrypted - The encrypted vault key payload
 * @param privateKey - User's X25519 private key (hex)
 * @returns The decrypted vault key, or null if decryption fails
 *
 * @example
 * ```typescript
 * const vaultKey = decryptVaultKey(encrypted, userPrivateKey);
 * if (!vaultKey) {
 *     console.error('Failed to decrypt vault key');
 * }
 * ```
 */
export function decryptVaultKey(
    encrypted: EncryptedVaultKey,
    privateKey: string,
): Buffer | null {

    const [result, err] = attemptSync(() => {

        // Derive shared secret from ephemeral pub + user's private
        const sharedSecret = deriveSharedSecret(privateKey, encrypted.ephemeralPubKey);

        // Derive decryption key
        const decKey = deriveEncryptionKey(sharedSecret, 'noorm-vault-key');

        // Decrypt
        const decipher = createDecipheriv(
            'aes-256-gcm',
            decKey,
            Buffer.from(encrypted.iv, 'hex'),
        );
        decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));

        const vaultKey = Buffer.concat([
            decipher.update(Buffer.from(encrypted.ciphertext, 'hex')),
            decipher.final(),
        ]);

        return vaultKey;

    });

    if (err) return null;

    return result;

}

/**
 * Encrypt a secret value with the vault key.
 *
 * Uses AES-256-GCM for authenticated encryption.
 *
 * @param value - The plaintext secret value
 * @param vaultKey - The 32-byte vault key
 *
 * @example
 * ```typescript
 * const encrypted = encryptSecret('my-api-key', vaultKey);
 * // Store JSON.stringify(encrypted) in encrypted_value column
 * ```
 */
export function encryptSecret(
    value: string,
    vaultKey: Buffer,
): { iv: string; authTag: string; ciphertext: string } {

    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', vaultKey, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        ciphertext: ciphertext.toString('hex'),
    };

}

/**
 * Decrypt a secret value with the vault key.
 *
 * @param encrypted - The encrypted secret payload
 * @param vaultKey - The 32-byte vault key
 * @returns The decrypted value, or null if decryption fails
 *
 * @example
 * ```typescript
 * const value = decryptSecret(encrypted, vaultKey);
 * if (!value) {
 *     console.error('Failed to decrypt secret');
 * }
 * ```
 */
export function decryptSecret(
    encrypted: { iv: string; authTag: string; ciphertext: string },
    vaultKey: Buffer,
): string | null {

    const [result, err] = attemptSync(() => {

        const decipher = createDecipheriv(
            'aes-256-gcm',
            vaultKey,
            Buffer.from(encrypted.iv, 'hex'),
        );
        decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));

        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(encrypted.ciphertext, 'hex')),
            decipher.final(),
        ]);

        return plaintext.toString('utf8');

    });

    if (err) return null;

    return result;

}
