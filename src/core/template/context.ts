/**
 * Template context builder.
 *
 * Builds the $ context object available in templates by:
 * 1. Loading inherited helpers from $helpers.ts files
 * 2. Auto-loading data files from the template's directory
 * 3. Adding config, secrets, env, and built-in helpers
 *
 * @example
 * ```typescript
 * import { buildContext } from './context'
 *
 * const ctx = await buildContext('/project/sql/users/001_create.sql.tmpl', {
 *     projectRoot: '/project',
 *     config: activeConfig,
 *     secrets: { API_KEY: '...' },
 * })
 *
 * // ctx now has: $.padId, $.users, $.config, $.secrets, $.quote, etc.
 * ```
 */
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import type { TemplateContext, RenderOptions } from './types.js';
import { HELPER_FILENAME } from './types.js';
import { loadHelpers } from './helpers.js';
import { loadDataFile, hasLoader, isExecutableExtension } from './loaders/index.js';
import { toContextKey, sqlEscape, sqlQuote, generateUuid, isoNow, isWithinRoot } from './utils.js';

/**
 * Tiers `$.secrets` actually resolves from, in priority order.
 *
 * Named here (not derived) because `buildContext` only ever sees the
 * already-built `options.secrets` record — it has no visibility into which
 * tiers produced it. Every render-path caller (`RunNamespace`,
 * `ChangesNamespace`, `TemplatesNamespace`, `run preview`, `run inspect`,
 * the TUI run context) sources `secrets` from `buildSecretsContext`, which
 * merges all three. Keep this list in step with that function: a
 * `MissingSecretError` that names a tier nobody searched sends the reader
 * looking in the wrong place, and one that omits a tier hides where the
 * value should have come from.
 *
 * A vault tier that cannot be reached (no vault, no key, unreachable DB)
 * degrades to the local tiers rather than failing, so it is still listed —
 * it was searched, it just had nothing to give.
 */
const SECRET_TIERS_SEARCHED = ['config-local', 'global-local', 'vault'] as const;

/**
 * Error when a template reads a secret that could not be resolved.
 *
 * A missing secret has no correct SQL rendering. Before this, a miss on the
 * plain `secrets` object read as `undefined`, and `sqlQuote` stringified
 * that into the literal text `undefined` — a real credential shipped with
 * the six-character password `undefined` (noorm#50). Thrown by the
 * `$.secrets` proxy's `get` trap; the `has` trap does not throw, so
 * templates can still probe for an optional secret via `'KEY' in $.secrets`.
 *
 * @example
 * ```typescript
 * const [, err] = await attempt(() => processFile(templatePath, { secrets }));
 * if (err instanceof MissingSecretError) {
 *     console.log(`missing ${err.key}, searched: ${err.tiersSearched.join(', ')}`);
 * }
 * ```
 */
export class MissingSecretError extends Error {

    override readonly name = 'MissingSecretError' as const;

    constructor(
        public readonly key: string,
        public readonly tiersSearched: readonly string[] = SECRET_TIERS_SEARCHED,
    ) {

        super(`Secret "${key}" not found (searched: ${tiersSearched.join(', ')})`);

    }

}

/**
 * Wrap a resolved secrets record so an unknown key fails loudly instead of
 * reading as `undefined`.
 *
 * `Object.keys`, spreading, and `JSON.stringify` never trigger `get` for a
 * key that isn't actually present — they resolve keys through `ownKeys`/
 * `getOwnPropertyDescriptor`, which this proxy leaves at the default
 * (forwarded to `target`) — so none of them throw. `toJSON` is special-cased
 * because `JSON.stringify` probes it as a `get` on the value itself before
 * falling back to default object serialization.
 *
 * @param secrets - The merged secrets record to guard
 * @returns A proxy over `secrets` whose `get` throws on an unresolved key
 *
 * @example
 * ```typescript
 * const secrets = createSecretsProxy({ API_KEY: 'abc' });
 * secrets.API_KEY;       // 'abc'
 * 'MISSING' in secrets;  // false, does not throw
 * secrets.MISSING;       // throws MissingSecretError
 * ```
 */
function createSecretsProxy(secrets: Record<string, string>): Record<string, string> {

    return new Proxy(secrets, {

        get(target, prop, receiver) {

            if (typeof prop === 'symbol' || prop === 'toJSON' || prop in target) {

                return Reflect.get(target, prop, receiver);

            }

            throw new MissingSecretError(prop);

        },

        has(target, prop) {

            return Reflect.has(target, prop);

        },

    });

}

/**
 * Build the template context ($) for a template file.
 *
 * @param templatePath - Absolute path to the template file
 * @param options - Render options (config, secrets, projectRoot)
 * @returns The complete template context
 */
export async function buildContext(
    templatePath: string,
    options: RenderOptions = {},
): Promise<TemplateContext> {

    const templateDir = path.dirname(templatePath);
    const projectRoot = options.projectRoot ?? process.cwd();

    // Read separately from the engine's own read: `run inspect` builds a
    // context without ever rendering, and it needs the same reference gate.
    // An unreadable template yields '' — no references, so no script runs.
    const [templateSource] = await attempt(() => readFile(templatePath, 'utf-8'));

    // 1. Load inherited helpers
    const { helpers } = await loadHelpers(templateDir, projectRoot);

    // 2. Auto-load data files from template directory
    const dataFiles = await loadDataFilesInDir(templateDir, templateSource ?? '');

    // 3. Check if data files include a config file
    const hasLocalConfig = 'config' in dataFiles;

    // 4. Build context with all components
    const ctx: TemplateContext = {
        // Inherited helpers (can be overridden by data files with same name)
        ...helpers,

        // Auto-loaded data files
        ...dataFiles,

        // Config (only if no local config.* file)
        ...(hasLocalConfig ? {} : { config: options.config }),

        // Secrets
        secrets: createSecretsProxy(options.secrets ?? {}),
        globalSecrets: options.globalSecrets ?? {},

        // Environment
        env: process.env as Record<string, string | undefined>,

        // Built-in helpers
        include: createIncludeHelper(templateDir, projectRoot, options),
        escape: sqlEscape,
        quote: sqlQuote,
        json: (value: unknown) => JSON.stringify(value),
        now: isoNow,
        uuid: generateUuid,
    };

    return ctx;

}

/**
 * Whether a template asks for a context key by name.
 *
 * Deliberately syntactic and narrow: `$.key` and `$['key']` are the two
 * documented ways to reach a data file, and a false negative costs the
 * author an explicit reference while a false positive re-opens the hole.
 * Only consulted for files whose loader executes code.
 *
 * @example
 * referencesContextKey("SELECT '{%~ $.seed.label %}'", 'seed'); // true
 * referencesContextKey('SELECT 1;', 'seed');                    // false
 */
function referencesContextKey(templateSource: string, key: string): boolean {

    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const pattern = new RegExp(
        `\\$\\s*(?:\\.\\s*${escaped}\\b|\\[\\s*(['"\`])${escaped}\\1\\s*\\])`,
    );

    return pattern.test(templateSource);

}

/**
 * Load all data files in a directory.
 *
 * Scans the directory for supported data file extensions and loads each one.
 * File names are converted to camelCase context keys.
 *
 * Files whose loader *executes* them (`.js`, `.mjs`, `.ts`) are loaded only
 * when `templateSource` references their key. Auto-loading them meant that
 * dropping a script beside any SQL file got it run — with no mention in the
 * template and no way for the user to know — during `preview`, `inspect`
 * and `--dry-run`, the three commands whose whole point is not to act.
 *
 * @param dir - Directory to scan
 * @param templateSource - Raw text of the template being rendered
 * @returns Object with camelCased keys and loaded data
 */
async function loadDataFilesInDir(
    dir: string,
    templateSource: string,
): Promise<Record<string, unknown>> {

    const data: Record<string, unknown> = {};

    const [entries, readErr] = await attempt(() => readdir(dir, { withFileTypes: true }));

    if (readErr || !entries) {

        observer.emit('error', {
            source: 'template',
            error: readErr ?? new Error('Failed to read directory'),
            context: { dir, operation: 'scan-data-files' },
        });

        return data;

    }

    for (const entry of entries) {

        // Skip directories
        if (!entry.isFile()) {

            continue;

        }

        // Skip dotfiles (includes helper files and temp files)
        if (entry.name.startsWith('.') || entry.name.startsWith(HELPER_FILENAME)) {

            continue;

        }

        // Skip template files
        if (entry.name.endsWith('.tmpl')) {

            continue;

        }

        const ext = path.extname(entry.name).toLowerCase();

        // Skip unsupported extensions
        if (!hasLoader(ext)) {

            continue;

        }

        // Skip .sql files in data loading (they're for include())
        if (ext === '.sql') {

            continue;

        }

        const filepath = path.join(dir, entry.name);
        const key = toContextKey(entry.name);

        if (isExecutableExtension(ext) && !referencesContextKey(templateSource, key)) {

            continue;

        }

        const [loaded, loadErr] = await attempt(() => loadDataFile(filepath));

        if (loadErr) {

            observer.emit('error', {
                source: 'template',
                error: loadErr,
                context: { filepath, operation: 'load-data-file' },
            });
            continue;

        }

        data[key] = loaded;

        observer.emit('template:load', {
            filepath,
            format: ext,
        });

    }

    return data;

}

/**
 * Create the include() helper function.
 *
 * The include helper resolves paths relative to the template's directory
 * and cannot escape the project root. If the included file is a template
 * (.sql.tmpl), it will be rendered recursively with the same options.
 *
 * @param templateDir - Template's directory
 * @param projectRoot - Project root (cannot escape)
 * @param options - Render options for nested templates
 * @returns The include helper function
 */
function createIncludeHelper(
    templateDir: string,
    projectRoot: string,
    options: RenderOptions,
): (includePath: string) => Promise<string> {

    return async (includePath: string): Promise<string> => {

        // Resolve path relative to template directory
        const resolved = path.resolve(templateDir, includePath);

        // Security: ensure we don't escape project root
        if (!isWithinRoot(resolved, path.resolve(projectRoot))) {

            throw new Error(`Include path escapes project root: ${includePath}`);

        }

        // If it's a template, render it recursively
        if (resolved.endsWith('.tmpl')) {

            // Dynamic import to avoid circular dependency
            const { processFile } = await import('./engine.js');
            const result = await processFile(resolved, options);

            return result.sql;

        }

        // Load raw file
        const [content, err] = await attempt(() => loadDataFile(resolved));

        if (err) {

            throw new Error(`Failed to include '${includePath}': ${err.message}`);

        }

        if (typeof content === 'string') {

            return content;

        }

        // Non-string content (shouldn't happen for .sql files)
        return JSON.stringify(content);

    };

}
