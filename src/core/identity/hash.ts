/**
 * Identity hash calculation.
 *
 * Identity hash uniquely identifies a user+machine combination.
 * Same user on different machines = different identity hashes.
 *
 * Format: SHA-256(email + '\0' + name + '\0' + machine + '\0' + os)
 *
 * @example
 * ```typescript
 * const hash = computeIdentityHash({
 *     email: 'alice@example.com',
 *     name: 'Alice Smith',
 *     machine: 'alice-macbook',
 *     os: 'darwin 24.5.0',
 * })
 * // 'a1b2c3d4e5f6...' (64 hex chars)
 * ```
 */
import { createHash } from 'crypto';

/**
 * Input for computing identity hash.
 */
export interface IdentityHashInput {
    email: string;
    name: string;
    machine: string;
    os: string;
}

/**
 * Compute identity hash from user details.
 *
 * Uses null byte separator to prevent collisions from concatenation.
 * For example, "ab" + "cd" vs "a" + "bcd" would collide without separator.
 *
 * @param input - User details to hash
 * @returns SHA-256 hash as 64-character hex string
 *
 * @example
 * ```typescript
 * const hash = computeIdentityHash({
 *     email: 'alice@example.com',
 *     name: 'Alice Smith',
 *     machine: 'alice-macbook',
 *     os: 'darwin 24.5.0',
 * })
 * ```
 */
export function computeIdentityHash(input: IdentityHashInput): string {

    // Validate inputs
    if (!input.email || !input.name || !input.machine || !input.os) {

        throw new Error('All fields required for identity hash: email, name, machine, os');

    }

    // Build hash input with null byte separators
    const hashInput = [input.email, input.name, input.machine, input.os].join('\0');

    // Compute SHA-256
    return createHash('sha256').update(hashInput, 'utf8').digest('hex');

}

/**
 * Validate an identity hash format.
 *
 * @param hash - Hash string to validate
 * @returns True if valid SHA-256 hex format
 */
export function isValidIdentityHash(hash: string): boolean {

    // SHA-256 = 32 bytes = 64 hex characters
    return /^[0-9a-f]{64}$/i.test(hash);

}

/**
 * Truncate identity hash for display.
 *
 * @param hash - Full identity hash
 * @param length - Number of characters to show (default 8)
 * @returns Truncated hash
 *
 * @example
 * ```typescript
 * truncateHash('a1b2c3d4e5f6...') // 'a1b2c3d4'
 * ```
 */
export function truncateHash(hash: string, length: number = 8): string {

    return hash.slice(0, length);

}
