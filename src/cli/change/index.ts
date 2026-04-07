/**
 * noorm change — manage schema changes.
 *
 * Bare invocation lists all changes and their current status.
 * Subcommands allow applying, reverting, and inspecting changes.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

import ff from './ff.js';
import run from './run.js';
import revert from './revert.js';
import history from './history.js';

const changeCommand = defineCommand({
    meta: {
        name: 'change',
        description: 'Manage schema changes',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    subCommands: {
        ff,
        run,
        revert,
        history,
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

(changeCommand as typeof changeCommand & { examples: string[] }).examples = [
    'noorm change',
    'noorm change --json',
    'noorm change ff',
    'noorm change run 001_users',
    'noorm change revert 001_users',
];

export default changeCommand;
