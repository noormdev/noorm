/**
 * File path utilities.
 *
 * Cross-cutting utilities for file discovery and filtering
 * used by both runner and change modules.
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
 * @param baseDir - Base directory for relative path matching (the resolved sql dir)
 * @param include - Relative paths to include (e.g., ['01_tables', '02_views'])
 * @param exclude - Relative paths to exclude (e.g., ['archive'])
 * @returns Filtered array of absolute file paths
 *
 * @example
 * ```typescript
 * const files = [
 *     '/project/sql/01_tables/users.sql',
 *     '/project/sql/02_views/active.sql',
 *     '/project/sql/archive/old.sql',
 * ]
 *
 * const filtered = filterFilesByPaths(
 *     files,
 *     '/project/sql',
 *     ['01_tables', '02_views'],
 *     ['archive']
 * )
 * // ['/project/sql/01_tables/users.sql', '/project/sql/02_views/active.sql']
 * ```
 */
export function filterFilesByPaths(
    files: string[],
    baseDir: string,
    include: string[],
    exclude: string[],
): string[] {

    const normalizedInclude = include.map(normalizePattern);
    const normalizedExclude = exclude.map(normalizePattern);

    return files.filter((file) => {

        const relativePath = relative(baseDir, file);

        // An empty include list means "everything under baseDir", not "nothing"
        const matchesInclude =
            normalizedInclude.length === 0 ||
            normalizedInclude.some((pattern) => matchesPattern(relativePath, pattern));

        const matchesExclude = normalizedExclude.some((pattern) => matchesPattern(relativePath, pattern));

        // Exclude wins if both match, consistent with rule evaluation
        return matchesInclude && !matchesExclude;

    });

}

/**
 * Normalizes a settings.yml path pattern to the host separator, so one
 * settings file matches identically on Windows and Unix.
 */
function normalizePattern(pattern: string): string {

    return pattern.split(/[\\/]/).join(sep);

}

/**
 * True when a baseDir-relative path is the pattern itself or sits underneath it.
 */
function matchesPattern(relativePath: string, pattern: string): boolean {

    return relativePath === pattern || relativePath.startsWith(pattern + sep);

}

/**
 * Returns the include patterns that match none of the discovered files.
 *
 * A mistyped include entry is otherwise invisible. It filters every file out,
 * and a build over zero files still reports success and exits 0 — so the
 * common `sql/01_tables` mistake (patterns are relative to `paths.sql`, so
 * that expands to `sql/sql/01_tables`) looks exactly like a working build
 * until something downstream fails on a missing table.
 *
 * Callers use this to name the offending entry rather than leaving the user
 * to infer it from an empty run.
 *
 * An empty `include` means "everything under baseDir" rather than a set of
 * patterns, so it never reports an unmatched entry.
 *
 * @example
 * ```typescript
 * findUnmatchedIncludePatterns(files, '/project/sql', ['01_tables', 'sql/01_tables'])
 * // ['sql/01_tables'] -- the sql/ prefix was repeated
 * ```
 */
export function findUnmatchedIncludePatterns(
    files: string[],
    baseDir: string,
    include: string[],
): string[] {

    const relativePaths = files.map((file) => relative(baseDir, file));

    return include.filter((pattern) => {

        const normalized = normalizePattern(pattern);

        return !relativePaths.some((relativePath) => matchesPattern(relativePath, normalized));

    });

}
