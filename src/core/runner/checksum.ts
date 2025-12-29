/**
 * File checksum utilities.
 *
 * Computes SHA-256 hashes for change detection. Files are re-executed
 * only when their checksum changes, enabling idempotent builds.
 *
 * WHY SHA-256: Cryptographically strong, fast enough for our use case,
 * and produces fixed-length output suitable for database storage.
 *
 * @example
 * ```typescript
 * import { computeChecksum, computeChecksumFromContent } from './checksum'
 *
 * const hash = await computeChecksum('/path/to/file.sql')
 * const hash2 = computeChecksumFromContent('SELECT 1;')
 * ```
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';

/**
 * Compute SHA-256 checksum of a file.
 *
 * @param filepath - Absolute path to the file
 * @returns SHA-256 hash as hex string
 * @throws Error if file cannot be read
 *
 * @example
 * ```typescript
 * const hash = await computeChecksum('/project/sql/001_users.sql')
 * // => 'a3f2b8c9d4e5...'
 * ```
 */
export async function computeChecksum(filepath: string): Promise<string> {

    const [content, err] = await attempt(() => readFile(filepath, 'utf-8'));

    if (err) {

        throw new Error(`Failed to read file for checksum: ${filepath}`, { cause: err });

    }

    return computeChecksumFromContent(content);

}

/**
 * Compute SHA-256 checksum from string content.
 *
 * Useful for computing checksums of rendered templates or
 * for testing without file I/O.
 *
 * @param content - String content to hash
 * @returns SHA-256 hash as hex string
 *
 * @example
 * ```typescript
 * const hash = computeChecksumFromContent('CREATE TABLE users (...);')
 * // => 'b4c7d8e9f0a1...'
 * ```
 */
export function computeChecksumFromContent(content: string): string {

    return createHash('sha256').update(content, 'utf-8').digest('hex');

}

/**
 * Compute combined checksum for multiple files.
 *
 * Creates a deterministic checksum by sorting file checksums
 * alphabetically and hashing the concatenated result.
 *
 * WHY: Build operations need a single checksum representing
 * the entire set of files. Sorting ensures the same files
 * always produce the same combined hash regardless of order.
 *
 * @param checksums - Array of individual file checksums
 * @returns Combined SHA-256 hash
 *
 * @example
 * ```typescript
 * const combined = computeCombinedChecksum([
 *     'abc123...',
 *     'def456...',
 * ])
 * ```
 */
export function computeCombinedChecksum(checksums: string[]): string {

    const sorted = [...checksums].sort();
    const combined = sorted.join('');

    return createHash('sha256').update(combined, 'utf-8').digest('hex');

}
