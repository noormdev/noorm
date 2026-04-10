/**
 * noorm change next — apply the next pending change.
 *
 * Applies one change at a time for controlled, step-by-step migration.
 * Pass a count argument to apply multiple pending changes.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const nextCommand = defineCommand({
    meta: {
        name: 'next',
        description: 'Apply the next pending change(s)',
    },
    args: {
        count: {
            type: 'positional',
            description: 'Number of pending changes to apply (default: 1)',
            required: false,
        },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const count = args.count ? parseInt(args.count, 10) : 1;

        if (isNaN(count) || count < 1) {

            process.stderr.write('Error: count must be a positive integer\n');
            process.exit(1);

        }

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.changes.next(count).then((res) => {

                    if (!args.json) {

                        if (res.executed === 0) {

                            logger.info('No pending changes to apply.');

                        }
                        else {

                            logger.info(`Applied ${res.executed} change(s)`, {
                                executed: res.executed,
                                skipped: res.skipped,
                                failed: res.failed,
                            });

                            for (const cs of res.changes) {

                                logger.info(`  ${cs.name} (${cs.status})`);

                            }

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, result, '');

        }

        process.exit(result.status === 'success' ? 0 : 2);

    },
});

(nextCommand as typeof nextCommand & { examples: string[] }).examples = [
    'noorm change next',
    'noorm change next 3',
    'noorm change next -c prod',
    'noorm change next --json',
];

export default nextCommand;
