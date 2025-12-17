/**
 * JavaScript/TypeScript module loader.
 *
 * Loads .js, .mjs, and .ts files via dynamic import.
 * Returns module.default if available, otherwise the entire module.
 *
 * @example
 * ```typescript
 * const data = await loadJs('/path/to/helpers.ts')
 * ```
 */
import { pathToFileURL } from 'node:url'


/**
 * Load a JavaScript or TypeScript module.
 *
 * Uses dynamic import to load the module. If the module has a default
 * export, returns that. Otherwise returns the entire module object.
 *
 * @param filepath - Absolute path to the JS/TS file
 * @returns The module's default export or the entire module
 * @throws If file cannot be imported
 */
export async function loadJs(filepath: string): Promise<unknown> {

    // Convert to file URL for cross-platform compatibility
    const url = pathToFileURL(filepath).href

    // Add cache-busting query param to avoid stale imports
    const urlWithCacheBust = `${url}?t=${Date.now()}`

    const mod = await import(urlWithCacheBust)

    // Return default export if available, otherwise the whole module
    return mod.default !== undefined ? mod.default : mod
}
