/**
 * noorm run file <path> — execute a single SQL file.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const fileCommand = defineCommand({
    meta: {
        name: 'file',
        description: 'Execute a single SQL file',
    },
    args: {
        path: {
            type: 'positional',
            description: 'Path to the SQL file to execute',
            required: true,
        },
        config: sharedArgs.config,
        dryRun: sharedArgs.dryRun,
        force: sharedArgs.force,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.run.file(args.path).then((res) => {

                    logger.info(`${res.filepath} (${res.status})`);
                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, result, '');

        }

        process.exit(result.status === 'success' || result.status === 'skipped' ? 0 : 1);

    },
});

(fileCommand as typeof fileCommand & { examples: string[] }).examples = [
    'noorm run file seed.sql',
    'noorm run file migrations/001_init.sql',
    'noorm run file sql/init.sql.tmpl --json',
];

export default fileCommand;
