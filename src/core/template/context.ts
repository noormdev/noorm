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
import { readdir } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import type { TemplateContext, RenderOptions } from './types.js';
import { HELPER_FILENAME } from './types.js';
import { loadHelpers } from './helpers.js';
import { loadDataFile, hasLoader } from './loaders/index.js';
import { toContextKey, sqlEscape, sqlQuote, generateUuid, isoNow } from './utils.js';

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

    // 1. Load inherited helpers
    const helpers = await loadHelpers(templateDir, projectRoot);

    // 2. Auto-load data files from template directory
    const dataFiles = await loadDataFilesInDir(templateDir);

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
        secrets: options.secrets ?? {},
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
 * Load all data files in a directory.
 *
 * Scans the directory for supported data file extensions and loads each one.
 * File names are converted to camelCase context keys.
 *
 * @param dir - Directory to scan
 * @returns Object with camelCased keys and loaded data
 */
async function loadDataFilesInDir(dir: string): Promise<Record<string, unknown>> {

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

        // Skip helper files
        if (entry.name.startsWith(HELPER_FILENAME)) {

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
        if (!resolved.startsWith(projectRoot)) {

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
