/**
 * noorm run file <path> — execute a single SQL file.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';
import { EXIT, exitCodeForStatus } from '../_exit.js';

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

                return ctx.noorm.run.file(args.path, { force: args.force, dryRun: args.dryRun }).then((res) => {

                    if (!args.json) {

                        if (res.status === 'failed') {

                            logger.error(`${res.filepath} (failed)`);
                            if (res.error) logger.error(`  error: ${res.error}`);

                        }
                        else if (res.status === 'skipped' && res.skipReason) {

                            logger.info(`${res.filepath} (skipped: ${res.skipReason})`);

                        }
                        else {

                            logger.info(`${res.filepath} (${res.status})`);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(EXIT.FAILURE);

        if (args.json) {

            outputResult(args, result, '');

        }

        process.exit(exitCodeForStatus(result.status));

    },
});

(fileCommand as typeof fileCommand & { examples: string[] }).examples = [
    'noorm run file seed.sql',
    'noorm run file migrations/001_init.sql',
    'noorm run file sql/init.sql.tmpl --json',
];

export default fileCommand;
