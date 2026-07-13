/**
 * noorm db reset — teardown + build (idempotent rebuild).
 *
 * Drops all user objects then rebuilds from SQL files.
 * Combines teardown and build into a single atomic operation.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, isYesMode, sharedArgs } from '../_utils.js';

const resetCommand = defineCommand({
    meta: {
        name: 'reset',
        description: 'Teardown + build (idempotent rebuild)',
    },
    args: {
        config: sharedArgs.config,
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        if (!isYesMode(args)) {

            process.stderr.write('Error: This is a destructive operation. Pass --yes to confirm.\n');
            process.exit(1);

        }

        const [, error] = await withContext({
            args,
            fn: async (ctx, logger) => {

                await ctx.noorm.db.reset();

                if (!args.json) {

                    logger.info('Database reset complete (teardown + build).');

                }

            },
        });

        if (error) process.exit(1);

        outputResult(args, { reset: true }, '');
        process.exit(0);

    },
});

(resetCommand as typeof resetCommand & { examples: string[] }).examples = [
    'noorm db reset --yes',
    'noorm db reset -c dev --yes',
    'noorm db reset --json --yes',
];

export default resetCommand;
