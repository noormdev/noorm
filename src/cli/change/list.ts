/**
 * noorm change list — list every known change with its status.
 *
 * This was previously the default behavior of bare `noorm change`. It
 * moved to an explicit subcommand so the parent `change` command can
 * render help like every other multi-command root (`config`, `vault`,
 * `identity`, …) without connecting to the database unnecessarily.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const listCommand = defineCommand({
    meta: {
        name: 'list',
        description: 'List every known change with its status',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [changes, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.changes.status().then((res) => {

                    if (!args.json) {

                        for (const cs of res) {

                            logger.info(`${cs.name} (${cs.status})`);

                        }

                        const pending = res.filter((c) => c.status === 'pending').length;

                        if (pending > 0) {

                            logger.info(`${pending} pending change(s)`);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, changes, '');

        }

        process.exit(0);

    },
});

(listCommand as typeof listCommand & { examples: string[] }).examples = [
    'noorm change list',
    'noorm change list --json',
    'noorm change list -c staging',
];

export default listCommand;
