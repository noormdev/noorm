/**
 * noorm run inspect <path> — inspect template context for a .sql.tmpl file.
 *
 * Shows what data files, helpers, config, secrets, and built-in
 * functions are available for a .sql.tmpl file without executing it.
 *
 * @example
 * ```bash
 * noorm run inspect sql/users/001_create.sql.tmpl
 * noorm run inspect sql/core/05_Cron/Crons.sql.tmpl --json
 * ```
 */
import { stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { defineCommand } from 'citty';
import { attempt, attemptSync } from '@logosdx/utils';

import { outputError, outputResult, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';
import { buildContext } from '../../core/template/context.js';
import { loadHelpers } from '../../core/template/helpers.js';
import { assertPolicy } from '../../core/policy/index.js';
import { getStateManager } from '../../core/state/index.js';
import { resolveRenderSecrets, RENDER_SECRETS_NOTICE } from './_render-secrets.js';

// Built-in helper names (always present in context)
const BUILTIN_HELPERS = new Set(['quote', 'escape', 'uuid', 'now', 'json', 'include']);
const STANDARD_KEYS = new Set(['config', 'secrets', 'globalSecrets', 'env']);

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

const inspectCommand = defineCommand({
    meta: {
        name: 'inspect',
        description: 'Inspect template context for a .sql.tmpl file',
    },
    args: {
        path: {
            type: 'positional',
            description: 'Path to the .sql.tmpl file',
            required: true,
        },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const projectRoot = process.cwd();
        const fullPath = join(projectRoot, args.path);
        const templateDir = dirname(fullPath);

        // buildContext only reads the template's *directory* for side-cars, so
        // a missing template produced a fully-populated context and exit 0 —
        // the command reported on a file that was never there. `run preview`
        // fails on the same path because it actually opens the file.
        const [stats] = await attempt(() => stat(fullPath));

        if (!stats?.isFile()) {

            outputError(args, `Template not found: ${args.path}`);
            process.exit(EXIT.USAGE);

        }

        // Load state for config + secrets
        const stateManager = getStateManager(projectRoot);
        const [, loadErr] = await attempt(() => stateManager.load());

        if (loadErr) {

            outputError(args, `Failed to load state: ${loadErr.message}`);
            process.exit(1);

        }

        const activeConfigName = args.config ?? stateManager.getActiveConfigName();
        const activeConfig = activeConfigName ? stateManager.getConfig(activeConfigName) : undefined;

        // inspect reports counts rather than secret values, but building the
        // context still executes the template's helper and side-car scripts,
        // so it needs the same gate as preview.
        if (activeConfig) {

            const [, policyErr] = attemptSync(() => assertPolicy('user', activeConfig, 'run:file'));

            if (policyErr) {

                outputError(args, policyErr.message);
                process.exit(1);

            }

        }

        const { secrets, vaultProbeFailed } = await resolveRenderSecrets(stateManager, activeConfigName);

        // Load context and helpers in parallel
        const [results, err] = await attempt(async () => {

            const [ctx, helperResult] = await Promise.all([
                buildContext(fullPath, {
                    projectRoot,
                    config: activeConfig as unknown as Record<string, unknown>,
                    secrets,
                    globalSecrets: stateManager.getAllGlobalSecrets(),
                }),
                loadHelpers(templateDir, projectRoot),
            ]);

            return { ctx, helperResult };

        });

        if (err) {

            outputError(args, `Failed to load context: ${err.message}`);
            process.exit(1);

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
            filepath: args.path,
            context: {
                dataFiles,
                helpers,
                helperErrors: results.helperResult.errors.map(e => ({
                    filepath: relative(projectRoot, e.filepath),
                    error: e.error.message,
                })),
                builtins,
                configKeys: activeConfig ? Object.keys(activeConfig) : [],
                secretCount: Object.keys(secrets).length,
                globalSecretCount: Object.keys(stateManager.getAllGlobalSecrets()).length,
            },
            ...(vaultProbeFailed ? { vaultProbeFailed: true, notice: RENDER_SECRETS_NOTICE } : {}),
        };

        const textLines = [
            `Template: ${args.path}`,
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

            const globalCount = Object.keys(stateManager.getAllGlobalSecrets()).length;
            textLines.push(`Secrets: ${Object.keys(secrets).length} resolved, ${globalCount} global`);

            if (vaultProbeFailed) {

                textLines.push(RENDER_SECRETS_NOTICE);

            }

        }

        outputResult(args, jsonOutput, textLines.join('\n'));

        process.exit(0);

    },
});

(inspectCommand as typeof inspectCommand & { examples: string[] }).examples = [
    'noorm run inspect sql/users/001_create.sql.tmpl',
    'noorm run inspect sql/core/05_Cron/Crons.sql.tmpl --json',
];

export default inspectCommand;
