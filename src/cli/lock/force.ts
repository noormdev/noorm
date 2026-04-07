/**
 * noorm lock force — force release any database lock regardless of ownership.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const forceCommand = defineCommand({
    meta: {
        name: 'force',
        description: 'Force release the database lock regardless of ownership',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [, error] = await withContext({
            args,
            fn: async (ctx, logger) => {

                await ctx.noorm.lock.forceRelease();
                logger.info('Lock force-released');

                return true;

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, { released: true, forced: true }, '');

        }

        process.exit(0);

    },
});

(forceCommand as typeof forceCommand & { examples: string[] }).examples = [
    'noorm lock force',
    'noorm lock force -c prod',
    'noorm lock force --json',
];

export default forceCommand;
