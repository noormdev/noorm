/**
 * Template engine using Eta.
 *
 * Wraps Eta with noorm's custom syntax and integrates with the context builder
 * for auto-loading data files and inherited helpers.
 *
 * @example
 * ```typescript
 * import { processFile, renderTemplate } from './engine'
 *
 * // Process any SQL file (template or raw)
 * const result = await processFile('/path/to/file.sql.tmpl', {
 *     config: activeConfig,
 *     secrets: { API_KEY: '...' },
 * })
 *
 * // Or render a template string directly
 * const sql = await renderTemplate(
 *     '{% for (const r of $.roles) { %}...',
 *     context,
 * )
 * ```
 */
import { readFile } from 'node:fs/promises';

import { Eta } from 'eta';

import { observer } from '../observer.js';
import type { TemplateContext, RenderOptions, ProcessResult } from './types.js';
import { TEMPLATE_EXTENSION } from './types.js';
import { buildContext } from './context.js';

/**
 * Strips entire `-- {% ... %}` directive lines from templates.
 *
 * The `-- {% %}` convention keeps .sql.tmpl files valid SQL (directives
 * look like comments to SQL parsers). Before Eta processes the template,
 * this regex strips the `-- ` prefix, trailing whitespace, and the line's
 * newline from directive-only lines so they produce no output.
 *
 * Only matches lines where `-- {% ... %}` is the ONLY content (plus whitespace).
 * Regular SQL comments and inline tags are not affected.
 *
 * `  -- {% for (const x of $.items) { %}\n` → `{% for (const x of $.items) { %}`
 * `SELECT 1; -- comment` → unchanged (no `{%`)
 * `-- {% if (x) { %} SELECT 1` → unchanged (content after tag)
 */
const DIRECTIVE_LINE_RE = /^[ \t]*-- (\{%.*?%\})[ \t]*$(?:\r?\n)?/gm;

/**
 * Eta instance configured with noorm's custom syntax.
 *
 * Custom delimiters:
 * - `{% %}` for JavaScript code (instead of `<% %>`)
 * - `{%~ %}` for raw output (instead of `<%~ %>`)
 * - `$` as the context variable (instead of `it`)
 *
 * autoTrim is disabled. Instead, the `-- {% %}` directive-line convention
 * is handled by DIRECTIVE_LINE_RE which strips entire directive lines
 * (including their newline) before Eta parses. This avoids Eta's autoTrim
 * gotchas where leftTrim eats content newlines after interpolation tags
 * (e.g. `{%= item %}\nAS` becoming `itemAS`).
 */
const eta = new Eta({
    // Custom tags for code blocks
    tags: ['{%', '%}'],

    // Variable name for context ($ instead of it)
    varName: '$',

    // Don't auto-escape (SQL doesn't need HTML escaping)
    autoEscape: false,

    // Disabled — directive-line stripping handles whitespace instead
    autoTrim: [false, false],

    // Allow async functions in templates
    useWith: false,

    // Don't cache templates (we handle caching at a higher level)
    cache: false,
});

/**
 * Check if a file path is a template.
 *
 * @param filepath - File path to check
 * @returns True if the file has the .tmpl extension
 */
export function isTemplate(filepath: string): boolean {

    return filepath.endsWith(TEMPLATE_EXTENSION);

}

/**
 * Render a template string with the given context.
 *
 * @param template - Template string with Eta syntax
 * @param context - The $ context object
 * @returns Rendered SQL string
 *
 * @example
 * ```typescript
 * const sql = await renderTemplate(
 *     '{% for (const role of $.roles) { %}INSERT INTO roles (name) VALUES ({%~ $.quote(role) %});\n{% } %}',
 *     { roles: ['admin', 'user'], quote: sqlQuote }
 * )
 * ```
 */
export async function renderTemplate(template: string, context: TemplateContext): Promise<string> {

    // Strip entire -- {% %} directive lines so they produce no output.
    // The -- prefix keeps .tmpl files valid SQL; the regex removes the
    // prefix, trailing whitespace, and the line's newline.
    const prepared = template.replace(DIRECTIVE_LINE_RE, '$1');

    const result = await eta.renderStringAsync(prepared, context);

    // Strip leading/trailing blank lines — directive lines at template
    // boundaries and file-trailing newlines can leave empty lines
    return result.replace(/^\n+|\n+$/g, '');

}

/**
 * Process a SQL file.
 *
 * If the file is a template (.sql.tmpl), renders it with the context.
 * If it's a raw SQL file (.sql), returns the content as-is.
 *
 * @param filepath - Absolute path to the SQL file
 * @param options - Render options (config, secrets, projectRoot)
 * @returns Process result with SQL content and metadata
 *
 * @example
 * ```typescript
 * const result = await processFile('/project/sql/users/001_create.sql.tmpl', {
 *     projectRoot: '/project',
 *     config: { name: 'dev', connection: { ... } },
 *     secrets: { API_KEY: 'secret123' },
 * })
 *
 * console.log(result.sql)        // Rendered SQL
 * console.log(result.isTemplate) // true
 * console.log(result.durationMs) // 12
 * ```
 */
export async function processFile(
    filepath: string,
    options: RenderOptions = {},
): Promise<ProcessResult> {

    // Read file content
    const content = await readFile(filepath, 'utf-8');

    // If not a template, return raw content
    if (!isTemplate(filepath)) {

        return {
            sql: content,
            isTemplate: false,
        };

    }

    // It's a template - build context and render
    const start = performance.now();

    const context = await buildContext(filepath, options);
    const sql = await renderTemplate(content, context);

    const durationMs = performance.now() - start;

    observer.emit('template:render', {
        filepath,
        durationMs,
    });

    return {
        sql,
        isTemplate: true,
        durationMs,
    };

}

/**
 * Process multiple SQL files.
 *
 * @param filepaths - Array of file paths to process
 * @param options - Render options
 * @returns Array of process results
 */
export async function processFiles(
    filepaths: string[],
    options: RenderOptions = {},
): Promise<ProcessResult[]> {

    const results: ProcessResult[] = [];

    for (const filepath of filepaths) {

        const result = await processFile(filepath, options);
        results.push(result);

    }

    return results;

}

// Export the Eta instance for advanced usage
export { eta };
