/**
 * noorm lock acquire — acquire an exclusive database lock.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

const acquireCommand = defineCommand({
    meta: {
        name: 'acquire',
        description: 'Acquire the database lock',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
        timeout: {
            type: 'string',
            description: 'Lock duration in milliseconds before it expires (default: 300000)',
        },
        reason: {
            type: 'string',
            description: 'Reason shown to anyone this lock blocks',
        },
    },
    async run({ args }) {

        // The TUI has collected both since it shipped; without them a
        // CI-acquired lock is always default-timeout and reasonless, so
        // whoever it blocks has no way to know what they are waiting on.
        const timeout = args.timeout === undefined ? undefined : Number(args.timeout);

        if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {

            outputError(args, `Invalid --timeout value: "${args.timeout}". Must be a positive number of milliseconds.`);
            process.exit(EXIT.USAGE);

        }

        const [lock, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                // Keys are omitted rather than passed as `undefined`:
                // LockManager merges with `{ ...DEFAULT_LOCK_OPTIONS, ...options }`,
                // so an explicit `timeout: undefined` erases the default instead
                // of falling back to it.
                return ctx.noorm.lock.acquire({
                    ...(timeout === undefined ? {} : { timeout }),
                    ...(args.reason === undefined ? {} : { reason: args.reason }),
                }).then((res) => {

                    if (!args.json) {

                        logger.info('Lock acquired', {
                            lockedBy: res.lockedBy,
                            expiresAt: res.expiresAt.toISOString(),
                        });

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(EXIT.FAILURE);

        if (args.json) {

            outputResult(args, {
                acquired: true,
                lockedBy: lock.lockedBy,
                expiresAt: lock.expiresAt.toISOString(),
                ...(args.reason ? { reason: args.reason } : {}),
            }, '');

        }

        process.exit(EXIT.SUCCESS);

    },
});

(acquireCommand as typeof acquireCommand & { examples: string[] }).examples = [
    'noorm lock acquire',
    'noorm lock acquire -c prod',
    'noorm lock acquire --timeout 600000 --reason "nightly migration"',
    'noorm lock acquire --json',
];

export default acquireCommand;
