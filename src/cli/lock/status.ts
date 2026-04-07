/**
 * noorm lock status — check current database lock status.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const statusCommand = defineCommand({
    meta: {
        name: 'status',
        description: 'Check current lock status',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [status, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.lock.status().then((res) => {

                    if (!args.json) {

                        if (res.isLocked && res.lock) {

                            logger.info(`Locked by ${res.lock.lockedBy}`, {
                                since: res.lock.lockedAt.toISOString(),
                                expires: res.lock.expiresAt.toISOString(),
                            });

                        }
                        else {

                            logger.info('No active lock');

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            const output = status.isLocked && status.lock
                ? {
                    isLocked: true,
                    lock: {
                        lockedBy: status.lock.lockedBy,
                        lockedAt: status.lock.lockedAt.toISOString(),
                        expiresAt: status.lock.expiresAt.toISOString(),
                    },
                }
                : { isLocked: false, lock: null };

            outputResult(args, output, '');

        }

        process.exit(0);

    },
});

(statusCommand as typeof statusCommand & { examples: string[] }).examples = [
    'noorm lock status',
    'noorm lock status -c prod',
    'noorm lock status --json',
];

export default statusCommand;
