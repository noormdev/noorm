/**
 * noorm run build — execute all SQL files in the schema directory.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const buildCommand = defineCommand({
    meta: {
        name: 'build',
        description: 'Execute all SQL files in schema directory',
    },
    args: {
        config: sharedArgs.config,
        force: sharedArgs.force,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.run.build({ force: args.force }).then((res) => {

                    logger.info('Build completed successfully', {
                        status: res.status,
                        filesRun: res.filesRun,
                        filesSkipped: res.filesSkipped,
                        filesFailed: res.filesFailed,
                        durationMs: res.durationMs,
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

(buildCommand as typeof buildCommand & { examples: string[] }).examples = [
    'noorm run build',
    'noorm run build --force',
    'noorm run build --json',
];

export default buildCommand;
