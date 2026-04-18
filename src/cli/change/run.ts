/**
 * noorm change run <name> — apply a single named change.
 *
 * If the name is omitted and stdin is a TTY, connects, fetches change
 * status, and prompts the user to pick from pending/reverted changes.
 * Non-TTY callers must pass the name or the command errors out.
 */
import * as p from '@clack/prompts';
import { defineCommand } from 'citty';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';
import { selectChangeFromStatus, requireTty } from './_prompt.js';

const runCommand = defineCommand({
    meta: {
        name: 'run',
        description: 'Apply a specific change by name',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Change name to apply (omit to pick interactively on a TTY)',
            required: false,
        },
        config: sharedArgs.config,
        force: sharedArgs.force,
        dryRun: sharedArgs.dryRun,
        json: sharedArgs.json,
    },
    async run({ args }) {

        if (!args.name && !requireTty('Change name')) process.exit(1);

        const [result, error] = await withContext({
            args,
            fn: async (ctx, logger) => {

                let changeName = args.name;

                if (!changeName) {

                    const status = await ctx.noorm.changes.status();

                    const picked = await selectChangeFromStatus(status, {
                        message: 'Pick a change to apply',
                        emptyMessage: 'No pending changes to apply.',
                        filter: (c) => !c.orphaned && (c.status === 'pending' || c.status === 'reverted'),
                    });

                    if (!picked) {

                        p.cancel('No change selected.');
                        throw new Error('aborted');

                    }

                    changeName = picked;

                }

                const res = await ctx.noorm.changes.apply(changeName);

                if (!args.json) {

                    logger.info(`${res.name} (${res.status})`);

                }

                return res;

            },
        });

        if (error) process.exit(1);

        if (!result) {

            outputError(args, 'No result returned');
            process.exit(1);

        }

        if (args.json) {

            outputResult(args, result, '');

        }

        process.exit(result.status === 'success' ? 0 : 2);

    },
});

(runCommand as typeof runCommand & { examples: string[] }).examples = [
    'noorm change run',
    'noorm change run 001_init',
    'noorm change run 002_users -c prod',
    'noorm change run 2024-02-01-notifications --json',
];

export default runCommand;
