/**
 * noorm change rewind <name> — revert applied changes back to a named change.
 *
 * Reverts changes in reverse order of application until and including
 * the named change. This is the inverse of `change ff`.
 *
 * If the name is omitted and stdin is a TTY, connects, fetches change
 * status, and prompts the user to pick from successfully applied
 * changes. Non-TTY callers must pass the name or the command errors out.
 */
import * as p from '@clack/prompts';
import { defineCommand } from 'citty';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';
import { selectChangeFromStatus, requireTty } from './_prompt.js';

const rewindCommand = defineCommand({
    meta: {
        name: 'rewind',
        description: 'Revert applied changes back to (and including) a named change',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Change name to revert to (omit to pick interactively on a TTY)',
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
                        message: 'Rewind back to which change?',
                        emptyMessage: 'No applied changes to rewind through.',
                        filter: (c) => c.status === 'success',
                    });

                    if (!picked) {

                        p.cancel('No change selected.');
                        throw new Error('aborted');

                    }

                    changeName = picked;

                }

                const res = await ctx.noorm.changes.rewind(changeName);

                if (!args.json) {

                    const summaryMsg = `Rewind: ${res.status} (${res.executed} reverted, ${res.failed} failed)`;

                    if (res.status !== 'success') {

                        logger.error(summaryMsg);

                    }
                    else {

                        logger.info(summaryMsg);

                    }

                    for (const change of res.changes) {

                        if (change.status === 'failed') {

                            logger.error(`  ${change.name} — failed`);
                            if (change.error) logger.error(`    error: ${change.error}`);

                        }
                        else {

                            logger.info(`  ${change.name} — ${change.status}`);

                        }

                    }

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

(rewindCommand as typeof rewindCommand & { examples: string[] }).examples = [
    'noorm change rewind',
    'noorm change rewind 001_init',
    'noorm change rewind 2024-02-01-notifications -c prod',
    'noorm change rewind 002_users --json',
    'noorm change rewind 003_roles --dry-run',
];

export default rewindCommand;
