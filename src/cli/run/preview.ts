/**
 * noorm run preview <path> — render a .sql.tmpl file and output the resulting SQL.
 *
 * Renders a .sql.tmpl file and outputs the resulting SQL
 * without executing it against the database.
 *
 * @example
 * ```bash
 * noorm run preview sql/users/001_create.sql.tmpl
 * noorm run preview sql/core/05_Cron/Crons.sql.tmpl --json
 * noorm run preview sql/migrations/002.sql.tmpl > rendered.sql
 * ```
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { defineCommand } from 'citty';
import { attempt, attemptSync } from '@logosdx/utils';

import { outputError, outputResult, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';
import { processFile } from '../../core/template/engine.js';
import { assertPolicy, resolveChannel } from '../../core/policy/index.js';
import { getStateManager } from '../../core/state/index.js';
import { resolveRenderSecrets, RENDER_SECRETS_NOTICE } from './_render-secrets.js';

const previewCommand = defineCommand({
    meta: {
        name: 'preview',
        description: 'Render a .sql.tmpl file and output the resulting SQL',
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

        // Named up front so a missing template reports "not found" instead of
        // an ENOENT surfacing from deep inside the template engine, and lands
        // on the same exit code `run inspect` uses for the same mistake.
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

        // Before secrets are resolved and before the template is touched:
        // the output is this config's secrets in plaintext, and producing it
        // runs the template's helper and side-car scripts. With no config
        // there is nothing config-scoped to protect — `resolveRenderSecrets`
        // returns an empty set for that case.
        if (activeConfig) {

            const [, policyErr] = attemptSync(() => assertPolicy(resolveChannel(), activeConfig, 'run:file'));

            if (policyErr) {

                outputError(args, policyErr.message);
                process.exit(1);

            }

        }

        const { secrets, vaultProbeFailed } = await resolveRenderSecrets(stateManager, activeConfigName);

        // Render the template
        const [result, err] = await attempt(() => processFile(fullPath, {
            projectRoot,
            config: activeConfig as unknown as Record<string, unknown>,
            secrets,
            globalSecrets: stateManager.getAllGlobalSecrets(),
        }));

        if (err) {

            // `--json` carries the message only: the stack embeds absolute
            // filesystem paths, and the error field is what CI pipelines log
            // and surface publicly. The stack still reaches the operator on
            // stderr in human mode.
            outputError(args, args.json ? err.message : err.stack ?? err.message);
            process.exit(EXIT.FAILURE);

        }

        if (args.json) {

            outputResult(args, {
                filepath: args.path,
                sql: result.sql,
                durationMs: result.durationMs,
                ...(vaultProbeFailed ? { vaultProbeFailed: true, notice: RENDER_SECRETS_NOTICE } : {}),
            }, '');

        }
        else {

            // Diagnostic, not result — stdout is reserved for the raw SQL
            // below so `noorm run preview x.sql.tmpl > rendered.sql` stays
            // pipeable.
            if (vaultProbeFailed) {

                process.stderr.write(RENDER_SECRETS_NOTICE + '\n');

            }

            // Output raw SQL so it can be piped to a file or other tool
            process.stdout.write(result.sql);

            // Add trailing newline if the SQL doesn't end with one
            if (!result.sql.endsWith('\n')) {

                process.stdout.write('\n');

            }

        }

        process.exit(0);

    },
});

(previewCommand as typeof previewCommand & { examples: string[] }).examples = [
    'noorm run preview sql/users/001_create.sql.tmpl',
    'noorm run preview sql/core/05_Cron/Crons.sql.tmpl --json',
    'noorm run preview sql/migrations/002.sql.tmpl > rendered.sql',
];

export default previewCommand;
