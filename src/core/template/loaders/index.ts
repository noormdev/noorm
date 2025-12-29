/**
 * Loader registry for data files.
 *
 * Maps file extensions to their respective loader functions.
 * Provides a unified interface for loading any supported data format.
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
import { loadJson5 } from './json5.js';
import { loadYaml } from './yaml.js';
import { loadCsv } from './csv.js';
import { loadJs } from './js.js';
import { loadSql } from './sql.js';

/**
 * Registry of loaders by file extension.
 */
const loaders: LoaderRegistry = {
    '.json': loadJson5,
    '.json5': loadJson5,
    '.yaml': loadYaml,
    '.yml': loadYaml,
    '.csv': loadCsv,
    '.js': loadJs,
    '.mjs': loadJs,
    '.ts': loadJs,
    '.sql': loadSql,
};

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
