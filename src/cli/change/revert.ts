/**
 * noorm change revert <name> — revert a single applied change.
 *
 * If the name is omitted and stdin is a TTY, connects, fetches change
 * status, and prompts the user to pick from successfully applied
 * changes. Non-TTY callers must pass the name or the command errors out.
 */
import * as p from '@clack/prompts';
import { defineCommand } from 'citty';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';
import { selectChangeFromStatus, requireTty } from './_prompt.js';

const revertCommand = defineCommand({
    meta: {
        name: 'revert',
        description: 'Revert a specific change by name',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Change name to revert (omit to pick interactively on a TTY)',
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
                        message: 'Pick a change to revert',
                        emptyMessage: 'No applied changes to revert.',
                        filter: (c) => c.status === 'success',
                    });

                    if (!picked) {

                        p.cancel('No change selected.');
                        throw new Error('aborted');

                    }

                    changeName = picked;

                }

                const res = await ctx.noorm.changes.revert(changeName);

                if (!args.json) {

                    logger.info(`${res.name} reverted (${res.status})`);

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

(revertCommand as typeof revertCommand & { examples: string[] }).examples = [
    'noorm change revert',
    'noorm change revert 001_init',
    'noorm change revert 002_users -c prod',
    'noorm change revert 002_users --json',
];

export default revertCommand;
