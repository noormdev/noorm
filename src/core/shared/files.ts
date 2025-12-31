/**
 * File path utilities.
 *
 * Cross-cutting utilities for file discovery and filtering
 * used by both runner and changeset modules.
 */
import { relative, sep } from 'path';

/**
 * Filter files by include/exclude path patterns.
 *
 * Takes absolute file paths and filters them based on relative path
 * prefixes from a base directory.
 *
 * Matching logic:
 * 1. Convert each file to relative path from baseDir
 * 2. Include if relative path starts with any include prefix
 * 3. Exclude if relative path starts with any exclude prefix
 * 4. Exclude wins if both match (consistent with rule evaluation)
 *
 * @param files - Absolute file paths (e.g., from discoverFiles())
 * @param baseDir - Base directory for relative path matching
 * @param include - Relative paths to include (e.g., ['schema/tables', 'schema/views'])
 * @param exclude - Relative paths to exclude (e.g., ['schema/archive'])
 * @returns Filtered array of absolute file paths
 *
 * @example
 * ```typescript
 * const files = [
 *     '/project/schema/tables/users.sql',
 *     '/project/schema/views/active.sql',
 *     '/project/schema/archive/old.sql',
 * ]
 *
 * const filtered = filterFilesByPaths(
 *     files,
 *     '/project',
 *     ['schema/tables', 'schema/views'],
 *     ['schema/archive']
 * )
 * // ['/project/schema/tables/users.sql', '/project/schema/views/active.sql']
 * ```
 */
export function filterFilesByPaths(
    files: string[],
    baseDir: string,
    include: string[],
    exclude: string[],
): string[] {

    // Normalize paths for consistent matching (handle Windows vs Unix)
    const normalizePattern = (pattern: string): string => {

        return pattern.split(/[\\/]/).join(sep);

    };

    const normalizedInclude = include.map(normalizePattern);
    const normalizedExclude = exclude.map(normalizePattern);

    return files.filter((file) => {

        const relativePath = relative(baseDir, file);

        // Check if path matches any include pattern
        const matchesInclude =
            normalizedInclude.length === 0 ||
            normalizedInclude.some((pattern) =>
                relativePath === pattern || relativePath.startsWith(pattern + sep),
            );

        // Check if path matches any exclude pattern
        const matchesExclude = normalizedExclude.some(
            (pattern) => relativePath === pattern || relativePath.startsWith(pattern + sep),
        );

        // Include if matches include AND doesn't match exclude
        // (exclude wins if both match)
        return matchesInclude && !matchesExclude;

    });

}

/**
 * Check if a file path matches a pattern prefix.
 *
 * @param filePath - Relative file path to check
 * @param pattern - Pattern prefix to match against
 * @returns True if the file path starts with the pattern
 */
export function matchesPathPrefix(filePath: string, pattern: string): boolean {

    const normalizedPattern = pattern.split(/[\\/]/).join(sep);

    return filePath === normalizedPattern || filePath.startsWith(normalizedPattern + sep);

}
