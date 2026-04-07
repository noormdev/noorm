/**
 * noorm db truncate — wipe all data, keep schema.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const truncateCommand = defineCommand({
    meta: {
        name: 'truncate',
        description: 'Wipe all data, keep schema',
    },
    args: {
        config: sharedArgs.config,
        force: sharedArgs.force,
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.db.truncate().then((res) => {

                    logger.info(`Truncated ${res.truncated.length} tables`);

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, {
                truncated: result.truncated,
                count: result.truncated.length,
            }, '');

        }

        process.exit(0);

    },
});

(truncateCommand as typeof truncateCommand & { examples: string[] }).examples = [
    'noorm db truncate',
    'noorm db truncate --yes',
    'noorm db truncate --force --yes',
    'noorm db truncate --json --yes',
];

export default truncateCommand;
