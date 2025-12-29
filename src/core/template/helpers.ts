/**
 * Helper file tree walker.
 *
 * Walks up the directory tree from a template's location to the project root,
 * collecting and merging $helpers.ts files. Child helpers override parent helpers.
 *
 * @example
 * ```typescript
 * import { loadHelpers } from './helpers'
 *
 * // Given structure:
 * // sql/
 * // ├── $helpers.ts          ← loaded first (base)
 * // └── users/
 * //     ├── $helpers.ts      ← loaded second (overrides)
 * //     └── 001_create.sql.tmpl
 *
 * const helpers = await loadHelpers('/project/sql/users', '/project')
 * // helpers contains merged exports from both files
 * ```
 */
import path from 'node:path';
import { stat } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import { HELPER_FILENAME, HELPER_EXTENSIONS } from './types.js';
import { loadJs } from './loaders/js.js';

/**
 * Find all helper files from a directory up to the project root.
 *
 * Returns paths in order from root to leaf (so child can override parent).
 *
 * @param fromDir - Starting directory (template's directory)
 * @param projectRoot - Project root directory (stop walking here)
 * @returns Array of helper file paths, ordered root to leaf
 */
export async function findHelperFiles(fromDir: string, projectRoot: string): Promise<string[]> {

    const helperPaths: string[] = [];
    let currentDir = path.resolve(fromDir);
    const root = path.resolve(projectRoot);

    // Walk up until we reach or pass the project root
    while (currentDir.startsWith(root)) {

        const helperPath = await findHelperInDir(currentDir);

        if (helperPath) {

            // Prepend so we get root-to-leaf order
            helperPaths.unshift(helperPath);

        }

        // Move up one directory
        const parentDir = path.dirname(currentDir);

        // Stop if we've reached the root or can't go higher
        if (parentDir === currentDir) {

            break;

        }

        currentDir = parentDir;

    }

    return helperPaths;

}

/**
 * Find a helper file in a directory.
 *
 * Checks for $helpers.ts, $helpers.js, $helpers.mjs in order.
 *
 * @param dir - Directory to search
 * @returns Path to helper file if found, null otherwise
 */
async function findHelperInDir(dir: string): Promise<string | null> {

    for (const ext of HELPER_EXTENSIONS) {

        const filepath = path.join(dir, `${HELPER_FILENAME}${ext}`);
        const [stats] = await attempt(() => stat(filepath));

        if (stats?.isFile()) {

            return filepath;

        }

    }

    return null;

}

/**
 * Load and merge helper files from a directory tree.
 *
 * Walks up from the template directory to the project root, loading each
 * $helpers.ts file found. Later helpers (closer to template) override
 * earlier helpers (closer to root).
 *
 * @param fromDir - Template's directory
 * @param projectRoot - Project root directory
 * @returns Merged helper exports
 *
 * @example
 * ```typescript
 * const helpers = await loadHelpers('/project/sql/users', '/project')
 * // helpers.padId() from sql/users/$helpers.ts
 * // helpers.formatDate() from sql/$helpers.ts
 * ```
 */
export async function loadHelpers(
    fromDir: string,
    projectRoot: string,
): Promise<Record<string, unknown>> {

    const helperPaths = await findHelperFiles(fromDir, projectRoot);
    const merged: Record<string, unknown> = {};

    for (const filepath of helperPaths) {

        const [mod, err] = await attempt(() => loadJs(filepath));

        if (err) {

            observer.emit('error', {
                source: 'template',
                error: err,
                context: { filepath, operation: 'load-helpers' },
            });
            continue;

        }

        // Merge exports (later files override earlier)
        if (mod && typeof mod === 'object') {

            const exports = mod as Record<string, unknown>;
            const exportCount = Object.keys(exports).length;

            Object.assign(merged, exports);

            observer.emit('template:helpers', {
                filepath,
                count: exportCount,
            });

        }

    }

    return merged;

}
