/**
 * AES-256-GCM encryption/decryption.
 *
 * Provides authenticated encryption - both confidentiality and integrity.
 * Any tampering with the ciphertext will be detected.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import type { EncryptedPayload } from '../types.js'
import { deriveKey, generateSalt } from './machine-id.js'


const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16


/**
 * Encrypt a string and return the encrypted payload.
 *
 * @example
 * ```typescript
 * const payload = encrypt('{"configs": {}}')
 * // {
 * //   version: 1,
 * //   algorithm: 'aes-256-gcm',
 * //   iv: 'base64...',
 * //   authTag: 'base64...',
 * //   ciphertext: 'base64...',
 * //   salt: 'base64...'
 * // }
 * ```
 */
export function encrypt(plaintext: string, passphrase?: string): EncryptedPayload {

    const salt = generateSalt()
    const key = deriveKey(salt, passphrase)
    const iv = randomBytes(IV_LENGTH)

    const cipher = createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    })

    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ])

    const authTag = cipher.getAuthTag()

    return {
        version: 1,
        algorithm: ALGORITHM,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        salt: salt.toString('base64'),
    }
}


/**
 * Decrypt an encrypted payload and return the plaintext.
 *
 * Throws if decryption fails (wrong key, tampered data, etc.)
 *
 * @example
 * ```typescript
 * const plaintext = decrypt(payload)
 * // '{"configs": {}}'
 *
 * // With passphrase
 * const plaintext = decrypt(payload, 'team-secret')
 * ```
 */
export function decrypt(payload: EncryptedPayload, passphrase?: string): string {

    if (payload.version !== 1) {

        throw new Error(`Unsupported encryption version: ${payload.version}`)
    }

    if (payload.algorithm !== ALGORITHM) {

        throw new Error(`Unsupported algorithm: ${payload.algorithm}`)
    }

    const salt = Buffer.from(payload.salt, 'base64')
    const key = deriveKey(salt, passphrase)
    const iv = Buffer.from(payload.iv, 'base64')
    const authTag = Buffer.from(payload.authTag, 'base64')
    const ciphertext = Buffer.from(payload.ciphertext, 'base64')

    const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    })

    decipher.setAuthTag(authTag)

    const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ])

    return plaintext.toString('utf8')
}
