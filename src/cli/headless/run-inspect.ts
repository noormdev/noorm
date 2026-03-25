/**
 * Headless: inspect template context.
 *
 * Shows what data files, helpers, config, secrets, and built-in
 * functions are available for a .sql.tmpl file without executing it.
 *
 * @example
 * ```bash
 * noorm -H run inspect sql/users/001_create.sql.tmpl
 * noorm -H --json run inspect sql/core/05_Cron/Crons.sql.tmpl
 * ```
 */
import { dirname, join, relative } from 'node:path';

import { attempt } from '@logosdx/utils';

import { outputError, outputResult, type HeadlessCommand } from './_helpers.js';
import { buildContext } from '../../core/template/context.js';
import { loadHelpers } from '../../core/template/helpers.js';
import { getStateManager } from '../../core/state/index.js';

// Built-in helper names (always present in context)
const BUILTIN_HELPERS = new Set(['quote', 'escape', 'uuid', 'now', 'json', 'include']);
const STANDARD_KEYS = new Set(['config', 'secrets', 'globalSecrets', 'env']);

export const help = `
# RUN INSPECT

Inspect template context for a .sql.tmpl file

## Usage

    noorm run inspect PATH
    noorm -H run inspect PATH

## Arguments

    PATH    Path to the .sql.tmpl file

## Description

Shows what data files, helpers, config, secrets, and built-in
functions are available in the template context (\`$\`).

Does not execute or render the template — just loads and
categorizes the context that would be available at render time.

## Examples

    noorm -H run inspect sql/users/001_create.sql.tmpl
    noorm -H --json run inspect sql/core/05_Cron/Crons.sql.tmpl

## JSON Output

\`\`\`json
{
    "filepath": "sql/users/001_create.sql.tmpl",
    "context": {
        "dataFiles": [{ "key": "roles", "type": "Array [3]" }],
        "helpers": [{ "key": "padId", "type": "Function" }],
        "helperErrors": [],
        "builtins": ["quote", "escape", "uuid", "now", "json", "include"],
        "configKeys": ["name", "connection"],
        "secretCount": 2,
        "globalSecretCount": 0
    }
}
\`\`\`

See \`noorm help run\` or \`noorm help run preview\`.
`;

/**
 * Describe a value's type for display.
 */
function describeType(value: unknown): string {

    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return `Array [${value.length}]`;
    if (typeof value === 'function') return 'Function';

    if (typeof value === 'object') {

        const keys = Object.keys(value);
        const preview = keys.slice(0, 4).join(', ');
        const suffix = keys.length > 4 ? ', ...' : '';

        return `Object {${preview}${suffix}}`;

    }

    if (typeof value === 'string') {

        const truncated = value.length > 30 ? value.slice(0, 30) + '...' : value;

        return `"${truncated}"`;

    }

    return String(value);

}

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (!params.path) {

        return outputError(flags, logger, 'File path required. Usage: noorm -H run inspect <file.sql.tmpl>');

    }

    const projectRoot = process.cwd();
    const fullPath = join(projectRoot, params.path);
    const templateDir = dirname(fullPath);

    // Load state for config + secrets
    const stateManager = getStateManager(projectRoot);
    const [, loadErr] = await attempt(() => stateManager.load());

    if (loadErr) {

        return outputError(flags, logger, `Failed to load state: ${loadErr.message}`);

    }

    const activeConfigName = flags.config ?? stateManager.getActiveConfigName();
    const activeConfig = activeConfigName ? stateManager.getConfig(activeConfigName) : undefined;

    // Load context and helpers in parallel
    const [results, err] = await attempt(async () => {

        const [ctx, helperResult] = await Promise.all([
            buildContext(fullPath, {
                projectRoot,
                config: activeConfig as unknown as Record<string, unknown>,
                secrets: activeConfigName ? stateManager.getAllSecrets(activeConfigName) : {},
                globalSecrets: stateManager.getAllGlobalSecrets(),
            }),
            loadHelpers(templateDir, projectRoot),
        ]);

        return { ctx, helperResult };

    });

    if (err) {

        return outputError(flags, logger, `Failed to load context: ${err.message}`);

    }

    // Categorize context entries
    const helperKeys = new Set(Object.keys(results.helperResult.helpers));
    const dataFiles: Array<{ key: string; type: string }> = [];
    const helpers: Array<{ key: string; type: string }> = [];
    const builtins: string[] = [];

    for (const [key, value] of Object.entries(results.ctx)) {

        if (STANDARD_KEYS.has(key)) continue;

        if (BUILTIN_HELPERS.has(key)) {

            builtins.push(key);
            continue;

        }

        const entry = { key, type: describeType(value) };

        if (helperKeys.has(key)) {

            helpers.push(entry);

        }
        else {

            dataFiles.push(entry);

        }

    }

    dataFiles.sort((a, b) => a.key.localeCompare(b.key));
    helpers.sort((a, b) => a.key.localeCompare(b.key));

    const jsonOutput = {
        filepath: params.path,
        context: {
            dataFiles,
            helpers,
            helperErrors: results.helperResult.errors.map(e => ({
                filepath: relative(projectRoot, e.filepath),
                error: e.error.message,
            })),
            builtins,
            configKeys: activeConfig ? Object.keys(activeConfig) : [],
            secretCount: activeConfigName ? Object.keys(stateManager.getAllSecrets(activeConfigName)).length : 0,
            globalSecretCount: Object.keys(stateManager.getAllGlobalSecrets()).length,
        },
    };

    const textLines = [
        `Template: ${params.path}`,
        `Config:   ${activeConfigName ?? '(none)'}`,
        '',
    ];

    if (dataFiles.length > 0) {

        textLines.push('Data Files:');

        for (const f of dataFiles) {

            textLines.push(`  $.${f.key}  ${f.type}`);

        }

        textLines.push('');

    }

    if (helpers.length > 0) {

        textLines.push('Helpers ($helpers):');

        for (const h of helpers) {

            textLines.push(`  $.${h.key}  ${h.type}`);

        }

        textLines.push('');

    }

    if (results.helperResult.errors.length > 0) {

        textLines.push('Helper Errors:');

        for (const e of results.helperResult.errors) {

            textLines.push(`  ${relative(projectRoot, e.filepath)}: ${e.error.message}`);

        }

        textLines.push('');

    }

    textLines.push(`Built-ins: ${builtins.join(', ')}`);

    if (activeConfigName) {

        const secretCount = Object.keys(stateManager.getAllSecrets(activeConfigName)).length;
        const globalCount = Object.keys(stateManager.getAllGlobalSecrets()).length;
        textLines.push(`Secrets: ${secretCount} config, ${globalCount} global`);

    }

    outputResult(flags, logger, jsonOutput, textLines.join('\n'));

    return 0;

};
