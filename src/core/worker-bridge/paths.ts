/**
 * Worker script path resolution.
 *
 * Resolves worker script paths that work across all execution contexts:
 * - Bun dev mode (src/): resolves .js → .ts automatically
 * - Node from dist/: resolves to dist/workers/*.js
 * - Bun compiled binary: string paths matching bun build --compile entry points
 *
 * @example
 * ```typescript
 * import { resolveWorker } from '../worker-bridge/paths.js';
 *
 * const worker = new WorkerBridge(resolveWorker('connection'));
 * ```
 */
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const IS_COMPILED = import.meta.url.includes('$bunfs');

// This file lives at {root}/src/core/worker-bridge/ or {root}/dist/core/worker-bridge/.
// Workers live at {root}/src/workers/ or {root}/dist/workers/ (sibling tree).
// Resolve relative to this module so the path lands in the correct tree.
const meta = import.meta as ImportMeta & { dir?: string };
const MODULE_DIR = typeof meta.dir === 'string'
    ? meta.dir
    : dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = resolve(MODULE_DIR, '../../workers');

/**
 * Resolve a worker script path by name.
 *
 * Returns an absolute path in dev mode, or a string entry-point path
 * for Bun compiled binaries.
 */
export function resolveWorker(name: string): string | URL {

    if (IS_COMPILED) {

        // In compiled binaries, Bun auto-detects src/ as --root and strips it.
        // It also compiles .ts → .js. So src/workers/compute.ts becomes
        // /$bunfs/root/workers/compute.js. Resolve against import.meta.url.
        return new URL(`./workers/${name}.js`, import.meta.url);

    }

    return resolve(WORKER_DIR, `${name}.js`);

}
