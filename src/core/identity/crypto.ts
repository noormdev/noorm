/**
 * Cryptographic operations for identity.
 *
 * Uses X25519 for key exchange and AES-256-GCM for encryption.
 * Implements the ephemeral keypair pattern for secure config sharing.
 *
 * @example
 * ```typescript
 * // Generate keypair on first run
 * const { publicKey, privateKey } = generateKeyPair()
 *
 * // Encrypt config for recipient
 * const payload = encryptForRecipient(config, recipientPubKey)
 *
 * // Decrypt received config
 * const config = decryptWithPrivateKey(payload, privateKey)
 * ```
 */
import {
    generateKeyPairSync,
    createCipheriv,
    createDecipheriv,
    createPrivateKey,
    createPublicKey,
    diffieHellman,
    hkdfSync,
    randomBytes,
} from 'crypto'

import type { KeyPair, SharedConfigPayload } from './types.js'


// =============================================================================
// Key Generation
// =============================================================================


/**
 * Generate an X25519 keypair for identity.
 *
 * X25519 is the standard for Diffie-Hellman key exchange.
 * Keys are returned as hex-encoded strings for storage.
 *
 * @example
 * ```typescript
 * const { publicKey, privateKey } = generateKeyPair()
 * // Store privateKey in ~/.noorm/identity.key
 * // Store publicKey in state and share with others
 * ```
 */
export function generateKeyPair(): KeyPair {

    const { publicKey, privateKey } = generateKeyPairSync('x25519', {
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    })

    return {
        publicKey: publicKey.toString('hex'),
        privateKey: privateKey.toString('hex'),
    }
}


// =============================================================================
// Key Derivation
// =============================================================================


/**
 * Derive a shared secret from private key and public key.
 *
 * Uses X25519 ECDH to derive a shared secret that both parties
 * can independently compute.
 */
function deriveSharedSecret(privateKeyHex: string, publicKeyHex: string): Buffer {

    const privateKey = createPrivateKey({
        key: Buffer.from(privateKeyHex, 'hex'),
        format: 'der',
        type: 'pkcs8',
    })

    const publicKey = createPublicKey({
        key: Buffer.from(publicKeyHex, 'hex'),
        format: 'der',
        type: 'spki',
    })

    return diffieHellman({
        privateKey,
        publicKey,
    })
}


/**
 * Derive encryption key from shared secret using HKDF.
 *
 * @param sharedSecret - Raw shared secret from ECDH
 * @param info - Context string for key derivation
 * @returns 32-byte key for AES-256
 */
function deriveEncryptionKey(sharedSecret: Buffer, info: string): Buffer {

    return Buffer.from(hkdfSync(
        'sha256',
        sharedSecret,
        Buffer.alloc(0), // No salt needed for ECDH-derived secrets
        info,
        32
    ))
}


// =============================================================================
// Encryption for Config Sharing
// =============================================================================


/**
 * Encrypt data for a recipient using their public key.
 *
 * Uses the ephemeral keypair pattern:
 * 1. Generate ephemeral X25519 keypair
 * 2. Derive shared secret via ECDH
 * 3. Derive encryption key from shared secret
 * 4. Encrypt with AES-256-GCM
 *
 * @param plaintext - Data to encrypt (will be JSON stringified if object)
 * @param recipientPubKey - Recipient's X25519 public key (hex)
 * @param sender - Sender's email for metadata
 * @param recipient - Recipient's email for metadata
 *
 * @example
 * ```typescript
 * const payload = encryptForRecipient(
 *     JSON.stringify(config),
 *     recipientPubKey,
 *     'alice@example.com',
 *     'bob@example.com'
 * )
 * ```
 */
export function encryptForRecipient(
    plaintext: string,
    recipientPubKey: string,
    sender: string,
    recipient: string
): SharedConfigPayload {

    // Generate ephemeral keypair for this message
    const ephemeral = generateKeyPair()

    // Derive shared secret via ECDH
    const sharedSecret = deriveSharedSecret(ephemeral.privateKey, recipientPubKey)

    // Derive encryption key from shared secret
    const key = deriveEncryptionKey(sharedSecret, 'noorm-config-share')

    // Generate random IV
    const iv = randomBytes(16)

    // Encrypt with AES-256-GCM
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    return {
        version: 1,
        sender,
        recipient,
        ephemeralPubKey: ephemeral.publicKey,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        ciphertext: ciphertext.toString('hex'),
    }
}


/**
 * Decrypt data using private key.
 *
 * Reverses the ephemeral keypair pattern:
 * 1. Derive shared secret from ephemeral pub + our private
 * 2. Derive decryption key
 * 3. Decrypt with AES-256-GCM
 *
 * @param payload - Encrypted payload from encryptForRecipient
 * @param privateKey - Recipient's X25519 private key (hex)
 *
 * @throws Error if decryption fails (wrong key, tampered data)
 *
 * @example
 * ```typescript
 * const plaintext = decryptWithPrivateKey(payload, privateKey)
 * const config = JSON.parse(plaintext)
 * ```
 */
export function decryptWithPrivateKey(
    payload: SharedConfigPayload,
    privateKey: string
): string {

    if (payload.version !== 1) {

        throw new Error(`Unsupported payload version: ${payload.version}`)
    }

    // Derive shared secret from ephemeral pub + our private
    const sharedSecret = deriveSharedSecret(privateKey, payload.ephemeralPubKey)

    // Derive decryption key
    const key = deriveEncryptionKey(sharedSecret, 'noorm-config-share')

    // Decrypt
    const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(payload.iv, 'hex')
    )
    decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'))

    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext, 'hex')),
        decipher.final(),
    ])

    return plaintext.toString('utf8')
}


// =============================================================================
// Key Derivation for State Encryption
// =============================================================================


/**
 * Derive encryption key from private key for state encryption.
 *
 * This is used to encrypt the local state file. The key is derived
 * directly from the identity's private key (no shared secret needed).
 *
 * @param privateKey - X25519 private key (hex)
 * @returns 32-byte key for AES-256
 *
 * @example
 * ```typescript
 * const stateKey = deriveStateKey(privateKey)
 * // Use stateKey with AES-256-GCM to encrypt/decrypt state
 * ```
 */
export function deriveStateKey(privateKey: string): Buffer {

    const privateKeyBuffer = Buffer.from(privateKey, 'hex')

    return Buffer.from(hkdfSync(
        'sha256',
        privateKeyBuffer,
        Buffer.alloc(0), // No salt - private key is already high entropy
        'noorm-state-encryption',
        32
    ))
}


/**
 * Encrypt state data using identity's private key.
 *
 * @param plaintext - State JSON string
 * @param privateKey - X25519 private key (hex)
 * @returns Encrypted payload with IV and auth tag
 */
export function encryptState(
    plaintext: string,
    privateKey: string
): { iv: string; authTag: string; ciphertext: string } {

    const key = deriveStateKey(privateKey)
    const iv = randomBytes(16)

    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    return {
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        ciphertext: ciphertext.toString('hex'),
    }
}


/**
 * Decrypt state data using identity's private key.
 *
 * @param encrypted - Encrypted payload from encryptState
 * @param privateKey - X25519 private key (hex)
 * @returns Decrypted state JSON string
 *
 * @throws Error if decryption fails
 */
export function decryptState(
    encrypted: { iv: string; authTag: string; ciphertext: string },
    privateKey: string
): string {

    const key = deriveStateKey(privateKey)

    const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(encrypted.iv, 'hex')
    )
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'))

    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(encrypted.ciphertext, 'hex')),
        decipher.final(),
    ])

    return plaintext.toString('utf8')
}
