/**
 * noorm db teardown — drop all database objects.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const teardownCommand = defineCommand({
    meta: {
        name: 'teardown',
        description: 'Drop all database objects',
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

                return ctx.noorm.db.teardown().then((res) => {

                    const droppedCount = res.dropped.tables.length +
                        res.dropped.views.length +
                        res.dropped.functions.length +
                        res.dropped.types.length;

                    logger.info(`Dropped ${droppedCount} objects`, {
                        tables: res.dropped.tables.length,
                        views: res.dropped.views.length,
                        functions: res.dropped.functions.length,
                        types: res.dropped.types.length,
                    });
                    return res;

                });

            },
        });

        if (error) process.exit(1);

        const droppedCount = result.dropped.tables.length +
            result.dropped.views.length +
            result.dropped.functions.length +
            result.dropped.types.length;

        if (args.json) {

            outputResult(args, {
                dropped: result.dropped,
                count: droppedCount,
            }, '');

        }

        process.exit(0);

    },
});

(teardownCommand as typeof teardownCommand & { examples: string[] }).examples = [
    'noorm db teardown',
    'noorm db teardown --yes',
    'noorm db teardown --force --yes',
    'noorm db teardown --json --yes',
];

export default teardownCommand;
