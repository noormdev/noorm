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
import { join } from 'node:path';

import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { outputError, sharedArgs } from '../_utils.js';
import { processFile } from '../../core/template/engine.js';
import { getStateManager } from '../../core/state/index.js';

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

        // Load state for config + secrets
        const stateManager = getStateManager(projectRoot);
        const [, loadErr] = await attempt(() => stateManager.load());

        if (loadErr) {

            outputError(args, `Failed to load state: ${loadErr.message}`);
            process.exit(1);

        }

        const activeConfigName = args.config ?? stateManager.getActiveConfigName();
        const activeConfig = activeConfigName ? stateManager.getConfig(activeConfigName) : undefined;

        // Render the template
        const [result, err] = await attempt(() => processFile(fullPath, {
            projectRoot,
            config: activeConfig as unknown as Record<string, unknown>,
            secrets: activeConfigName ? stateManager.getAllSecrets(activeConfigName) : {},
            globalSecrets: stateManager.getAllGlobalSecrets(),
        }));

        if (err) {

            outputError(args, err.stack ?? err.message);
            process.exit(1);

        }

        if (args.json) {

            process.stdout.write(JSON.stringify({
                filepath: args.path,
                sql: result.sql,
                durationMs: result.durationMs,
            }) + '\n');

        }
        else {

            // Output raw SQL so it can be piped to a file or other tool
            process.stdout.write(result.sql);

            // Add trailing newline if the SQL doesn't end with one
            if (!result.sql.endsWith('\n')) {

                process.stdout.write('\n');

            }

        }

    },
});

(previewCommand as typeof previewCommand & { examples: string[] }).examples = [
    'noorm run preview sql/users/001_create.sql.tmpl',
    'noorm run preview sql/core/05_Cron/Crons.sql.tmpl --json',
    'noorm run preview sql/migrations/002.sql.tmpl > rendered.sql',
];

export default previewCommand;
