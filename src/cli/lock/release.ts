/**
 * noorm lock release — release the current database lock.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const releaseCommand = defineCommand({
    meta: {
        name: 'release',
        description: 'Release the current database lock',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [, error] = await withContext({
            args,
            fn: async (ctx, logger) => {

                await ctx.noorm.lock.release();
                logger.info('Lock released');

                return true;

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, { released: true }, '');

        }

        process.exit(0);

    },
});

(releaseCommand as typeof releaseCommand & { examples: string[] }).examples = [
    'noorm lock release',
    'noorm lock release -c prod',
    'noorm lock release --json',
];

export default releaseCommand;
