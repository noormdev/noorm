/**
 * noorm db reset — teardown + build (idempotent rebuild).
 *
 * Drops all user objects then rebuilds from SQL files.
 * Combines teardown and build into a single atomic operation.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, outputError, isYesMode, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

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

            // outputError, not a bare stderr write: `--json` callers got an
            // empty stdout here and so had no envelope to key a failure off.
            // Stays FAILURE, not USAGE: every other confirmation/`--force`
            // refusal in the CLI exits 1, and splitting this one off would
            // make the code mean two things depending on the command.
            outputError(args, 'This is a destructive operation. Pass --yes to confirm.');
            process.exit(EXIT.FAILURE);

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
