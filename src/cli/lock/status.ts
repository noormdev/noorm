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
            fn: (ctx) => ctx.noorm.lock.status(),
        });

        if (error) process.exit(1);

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

        const text = status.isLocked && status.lock
            ? `Locked by ${status.lock.lockedBy} (since ${status.lock.lockedAt.toISOString()}, expires ${status.lock.expiresAt.toISOString()})`
            : 'No active lock';

        outputResult(args, output, text);

        process.exit(0);

    },
});

(statusCommand as typeof statusCommand & { examples: string[] }).examples = [
    'noorm lock status',
    'noorm lock status -c prod',
    'noorm lock status --json',
];

export default statusCommand;
