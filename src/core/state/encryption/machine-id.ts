/**
 * Machine ID-based key derivation.
 *
 * Uses the machine's unique identifier to derive encryption keys.
 * This ties the encrypted state to the specific machine, preventing
 * decryption on other machines without the passphrase.
 */
import { machineIdSync } from 'node-machine-id'
import { createHash, pbkdf2Sync, randomBytes } from 'crypto'
import os from 'os'


const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 32  // 256 bits for AES-256


/**
 * Get the machine's unique identifier.
 *
 * Falls back to a hash of hostname + username if machine-id fails
 * (e.g., in some containerized environments).
 *
 * @example
 * ```typescript
 * const id = getMachineId()
 * // "a1b2c3d4e5f6..." (hex string)
 * ```
 */
export function getMachineId(): string {

    try {

        return machineIdSync(true)  // true = original format
    }
    catch {

        // Fallback for environments where machine-id isn't available
        const fallback = `${os.hostname()}-${os.userInfo().username}`
        return createHash('sha256').update(fallback).digest('hex')
    }
}


/**
 * Derive an encryption key from machine ID + optional passphrase.
 *
 * Uses PBKDF2 with SHA-256 for key derivation, which is resistant
 * to brute-force attacks.
 *
 * @example
 * ```typescript
 * const salt = generateSalt()
 * const key = deriveKey(salt)  // Machine-only key
 * const keyWithPass = deriveKey(salt, 'team-secret')  // With passphrase
 * ```
 */
export function deriveKey(salt: Buffer, passphrase?: string): Buffer {

    const machineId = getMachineId()
    const secret = passphrase
        ? `${machineId}:${passphrase}`
        : machineId

    return pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
}


/**
 * Generate a random salt for key derivation.
 *
 * @example
 * ```typescript
 * const salt = generateSalt()
 * // 16 random bytes
 * ```
 */
export function generateSalt(): Buffer {

    return randomBytes(16)
}
