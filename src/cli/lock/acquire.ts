/**
 * noorm lock acquire — acquire an exclusive database lock.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const acquireCommand = defineCommand({
    meta: {
        name: 'acquire',
        description: 'Acquire the database lock',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [lock, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.lock.acquire().then((res) => {

                    logger.info('Lock acquired', {
                        lockedBy: res.lockedBy,
                        expiresAt: res.expiresAt.toISOString(),
                    });
                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, {
                acquired: true,
                lockedBy: lock.lockedBy,
                expiresAt: lock.expiresAt.toISOString(),
            }, '');

        }

        process.exit(0);

    },
});

(acquireCommand as typeof acquireCommand & { examples: string[] }).examples = [
    'noorm lock acquire',
    'noorm lock acquire -c prod',
    'noorm lock acquire --json',
];

export default acquireCommand;
