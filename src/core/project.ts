/**
 * Project Root Discovery
 *
 * Walks up the directory tree from the current working directory
 * to find the nearest .noorm project directory. Stops at the user's
 * home directory to avoid traversing system directories.
 *
 * Directory hierarchy:
 * - ~/.noorm/         = Global (identity, secrets) - NOT a project
 * - ~/projects/myapp/.noorm/ = Project - should be used
 *
 * When a project is found, callers should chdir to that directory
 * so all relative paths work correctly.
 */
import { existsSync, realpathSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';

import { SETTINGS_DIR_PATH } from './settings/defaults.js';

/**
 * Result of project root discovery.
 */
export interface ProjectDiscoveryResult {
    /** Absolute path to the project root (parent of .noorm), or null if not found */
    projectRoot: string | null;

    /** Absolute path to home .noorm if it exists */
    homeNoorm: string | null;

    /** Whether a project was found (not just home .noorm) */
    hasProject: boolean;

    /** The original working directory before any chdir */
    originalCwd: string;
}

/**
 * Find the nearest project root by walking up from startDir.
 *
 * Walks up the directory tree looking for a .noorm folder. Stops at
 * the user's home directory. Returns the project root (parent of .noorm)
 * if found before home, otherwise returns null.
 *
 * @example
 * ```typescript
 * // From ~/projects/myapp/packages/db
 * const result = findProjectRoot();
 * // result.projectRoot = '/Users/me/projects/myapp'  (has .noorm)
 * // result.hasProject = true
 *
 * // From ~/projects/newapp (no .noorm anywhere)
 * const result = findProjectRoot();
 * // result.projectRoot = null
 * // result.hasProject = false
 * ```
 */
export function findProjectRoot(startDir?: string): ProjectDiscoveryResult {

    // === Declaration block ===
    // Use realpathSync to resolve symlinks (macOS /var -> /private/var)
    const originalCwd = realpathSync(process.cwd());
    const start = realpathSync(resolve(startDir ?? originalCwd));
    const home = realpathSync(homedir());
    const homeNoormPath = join(home, SETTINGS_DIR_PATH);

    // === Validation block ===
    // Check if home .noorm exists
    const homeNoorm = existsSync(homeNoormPath) ? homeNoormPath : null;

    // === Business logic block ===
    let current = start;

    while (true) {

        const noormPath = join(current, SETTINGS_DIR_PATH);

        // Found .noorm in this directory
        if (existsSync(noormPath)) {

            // If this is the home directory, don't treat it as a project
            if (current === home) {

                break;

            }

            // Found a project .noorm
            return {
                projectRoot: current,
                homeNoorm,
                hasProject: true,
                originalCwd,
            };

        }

        // Move to parent directory
        const parent = dirname(current);

        // Reached filesystem root or home directory - stop
        if (parent === current || current === home) {

            break;

        }

        current = parent;

    }

    // === Commit block ===
    // No project found
    return {
        projectRoot: null,
        homeNoorm,
        hasProject: false,
        originalCwd,
    };

}

/**
 * Initialize project context by finding the project root and optionally
 * changing to that directory.
 *
 * This is the primary entry point for CLI initialization. It:
 * 1. Finds the nearest project root
 * 2. Optionally changes working directory to project root
 * 3. Returns discovery result for further processing
 *
 * @param options.chdir - If true, calls process.chdir() to project root (default: true)
 * @returns Discovery result with project information
 *
 * @example
 * ```typescript
 * // In CLI entry point
 * const result = initProjectContext();
 *
 * if (result.hasProject) {
 *     // Project found, cwd is now project root
 *     console.log('Using project:', result.projectRoot);
 * }
 * else if (result.homeNoorm) {
 *     // No project but has global identity - prompt to init
 *     console.log('No project found. Run: noorm init');
 * }
 * else {
 *     // First time user - prompt for identity setup
 *     console.log('Welcome! Run: noorm init');
 * }
 * ```
 */
export function initProjectContext(options: { chdir?: boolean } = {}): ProjectDiscoveryResult {

    // === Declaration block ===
    const { chdir = true } = options;

    // === Business logic block ===
    const result = findProjectRoot();

    // Change to project root if found and chdir is enabled
    if (result.hasProject && result.projectRoot && chdir) {

        process.chdir(result.projectRoot);

    }

    // === Commit block ===
    return result;

}

/**
 * Check if a directory is a noorm project (has .noorm folder).
 *
 * @example
 * ```typescript
 * if (isNoormProject('/path/to/dir')) {
 *     console.log('This is a noorm project');
 * }
 * ```
 */
export function isNoormProject(dir: string): boolean {

    const noormPath = join(resolve(dir), SETTINGS_DIR_PATH);

    return existsSync(noormPath);

}

/**
 * Get the path to the global noorm directory (~/.noorm).
 *
 * @example
 * ```typescript
 * const globalDir = getGlobalNoormPath();
 * // '/Users/me/.noorm'
 * ```
 */
export function getGlobalNoormPath(): string {

    return join(homedir(), SETTINGS_DIR_PATH);

}

/**
 * Check if the global noorm directory exists.
 *
 * @example
 * ```typescript
 * if (hasGlobalNoorm()) {
 *     console.log('User has global identity');
 * }
 * ```
 */
export function hasGlobalNoorm(): boolean {

    return existsSync(getGlobalNoormPath());

}
