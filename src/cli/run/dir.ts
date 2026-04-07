/**
 * noorm run dir <path> — execute all SQL files in a directory.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const dirCommand = defineCommand({
    meta: {
        name: 'dir',
        description: 'Execute all SQL files in a directory',
    },
    args: {
        path: {
            type: 'positional',
            description: 'Path to the directory containing SQL files',
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

                return ctx.noorm.run.dir(args.path, { force: args.force, dryRun: args.dryRun }).then((res) => {

                    logger.info(`Run directory ${res.status}`, {
                        filesRun: res.filesRun,
                        filesSkipped: res.filesSkipped,
                        filesFailed: res.filesFailed,
                    });
                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, result, '');

        }

        process.exit(result.status === 'success' ? 0 : 2);

    },
});

(dirCommand as typeof dirCommand & { examples: string[] }).examples = [
    'noorm run dir migrations/',
    'noorm run dir seeds/',
    'noorm run dir sql/01_tables/ --json',
];

export default dirCommand;
