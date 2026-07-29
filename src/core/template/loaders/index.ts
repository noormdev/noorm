/**
 * Loader registry for data files.
 *
 * Maps file extensions to their respective loader functions.
 * Provides a unified interface for loading any supported data format.
 *
 * Loaders with external dependencies (json5, yaml, csv-parse) are
 * lazy-loaded on first use to avoid pulling heavy parsers into the
 * bundle when they aren't needed.
 *
 * @example
 * ```typescript
 * import { loadDataFile, getLoader, hasLoader } from './loaders'
 *
 * if (hasLoader('.json5')) {
 *     const data = await loadDataFile('/path/to/config.json5')
 * }
 * ```
 */
import path from 'node:path';

import type { Loader, LoaderRegistry } from '../types.js';
import { loadJs } from './js.js';
import { loadSql } from './sql.js';
import { loadDt } from './dt.js';

// ─────────────────────────────────────────────────────────────
// Lazy Loaders
// ─────────────────────────────────────────────────────────────

/**
 * Lazy wrapper for JSON5 loader.
 *
 * Defers `import('json5')` until a .json or .json5 file is loaded.
 */
async function lazyLoadJson5(filepath: string): Promise<unknown> {

    const { loadJson5 } = await import('./json5.js');

    return loadJson5(filepath);

}

/**
 * Lazy wrapper for YAML loader.
 *
 * Defers `import('yaml')` until a .yaml or .yml file is loaded.
 */
async function lazyLoadYaml(filepath: string): Promise<unknown> {

    const { loadYaml } = await import('./yaml.js');

    return loadYaml(filepath);

}

/**
 * Lazy wrapper for CSV loader.
 *
 * Defers `import('csv-parse/sync')` until a .csv file is loaded.
 */
async function lazyLoadCsv(filepath: string): Promise<unknown> {

    const { loadCsv } = await import('./csv.js');

    return loadCsv(filepath);

}

// ─────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────

/**
 * Registry of loaders by file extension.
 *
 * json5, yaml, and csv loaders are lazy — their parser libraries
 * are only imported when a file of that type is first loaded.
 */
const loaders: LoaderRegistry = {
    '.json': lazyLoadJson5,
    '.json5': lazyLoadJson5,
    '.yaml': lazyLoadYaml,
    '.yml': lazyLoadYaml,
    '.csv': lazyLoadCsv,
    '.js': loadJs,
    '.mjs': loadJs,
    '.ts': loadJs,
    '.sql': loadSql,
    '.dt': loadDt,
    '.dtz': loadDt,
    // NO .dtzx — can't provide passphrase in template context
};

/**
 * Extensions whose loader executes the file rather than parsing it.
 *
 * Kept beside the registry so that registering a new loader forces the
 * author to answer "does this run code?" — the whole class of problem here
 * was that `.js`/`.mjs`/`.ts` sat in the same map as `.csv` and inherited
 * `.csv`'s auto-load-everything treatment.
 */
const EXECUTABLE_EXTENSIONS = new Set(['.js', '.mjs', '.ts']);

/**
 * Check if a loader exists for the given extension.
 *
 * @param ext - File extension (e.g., '.json5')
 * @returns True if a loader is registered for this extension
 */
export function hasLoader(ext: string): boolean {

    return ext in loaders;

}

/**
 * Whether loading a file with this extension runs arbitrary code in the
 * current process.
 *
 * Callers use this to require an explicit opt-in before touching the file.
 * Parsing a `.csv` cannot do anything; importing a `.ts` can read the
 * identity key out of the environment.
 *
 * @example
 * isExecutableExtension('.ts');   // true
 * isExecutableExtension('.json'); // false
 */
export function isExecutableExtension(ext: string): boolean {

    return EXECUTABLE_EXTENSIONS.has(ext);

}

/**
 * Get the loader function for a file extension.
 *
 * @param ext - File extension (e.g., '.json5')
 * @returns The loader function, or undefined if not found
 */
export function getLoader(ext: string): Loader | undefined {

    return loaders[ext];

}

/**
 * Load a data file using the appropriate loader.
 *
 * Determines the loader from the file extension and loads the file.
 *
 * @param filepath - Absolute path to the data file
 * @returns The loaded and parsed data
 * @throws If no loader exists for the file extension
 * @throws If the file cannot be loaded or parsed
 *
 * @example
 * ```typescript
 * const users = await loadDataFile('/path/to/users.json5')
 * const config = await loadDataFile('/path/to/config.yml')
 * ```
 */
export async function loadDataFile(filepath: string): Promise<unknown> {

    const ext = path.extname(filepath).toLowerCase();
    const loader = getLoader(ext);

    if (!loader) {

        throw new Error(`No loader registered for extension: ${ext}`);

    }

    return loader(filepath);

}

/**
 * Get all supported data file extensions.
 *
 * @returns Array of supported extensions (e.g., ['.json', '.json5', '.yml', ...])
 */
export function getSupportedExtensions(): string[] {

    return Object.keys(loaders);

}

// Re-export individual loaders for direct use
export { loadJson5 } from './json5.js';
export { loadYaml } from './yaml.js';
export { loadCsv } from './csv.js';
export { loadJs } from './js.js';
export { loadSql } from './sql.js';
export { loadDt } from './dt.js';
