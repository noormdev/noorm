/**
 * JavaScript/TypeScript module loader.
 *
 * Loads .js, .mjs, and .ts files via dynamic import.
 * Returns module.default if available, otherwise the entire module.
 *
 * In compiled Bun binaries, bare specifier resolution fails because
 * the binary's resolver uses its virtual $bunfs. We use Bun.build()
 * to bundle the file with all dependencies resolved, then import
 * the bundled output.
 *
 * @example
 * ```typescript
 * const data = await loadJs('/path/to/helpers.ts')
 * ```
 */
import { dirname, join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const IS_COMPILED = import.meta.url.includes('$bunfs');

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

    const mod = IS_COMPILED
        ? await loadWithBunBuild(filepath)
        : await loadWithImport(filepath);

    // Return default export if available, otherwise the whole module
    return mod['default'] !== undefined ? mod['default'] : mod;

}

/**
 * Load a module using Bun.build() for compiled binary context.
 *
 * Bun.build() resolves all bare specifiers and bundles them into
 * a single self-contained file, bypassing the $bunfs resolver.
 */
async function loadWithBunBuild(filepath: string): Promise<Record<string, unknown>> {

    const fileDir = dirname(filepath);
    const tmpFile = join(fileDir, `.noorm-helper-${randomBytes(8).toString('hex')}.js`);

    const result = await Bun.build({
        entrypoints: [filepath],
        outdir: fileDir,
        naming: tmpFile.split('/').pop()!,
        target: 'bun',
        format: 'esm',
    });

    if (!result.success) {

        const messages = result.logs.map(l => l.message).join('; ');
        throw new Error(`Failed to bundle ${filepath}: ${messages}`);

    }

    const mod = await import(pathToFileURL(tmpFile).href);

    unlinkSync(tmpFile);

    return mod as Record<string, unknown>;

}

/**
 * Load a module via dynamic import().
 *
 * Used in dev mode (node/bun from dist/) where import() resolves
 * bare specifiers correctly from the file's location.
 */
async function loadWithImport(filepath: string): Promise<Record<string, unknown>> {

    const url = pathToFileURL(filepath).href;

    // Cache-busting query param to avoid stale imports
    const urlWithCacheBust = `${url}?t=${Date.now()}`;

    return await import(urlWithCacheBust) as Record<string, unknown>;

}
