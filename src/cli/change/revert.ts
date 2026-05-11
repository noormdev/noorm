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

        const dryRun = Boolean(args.dryRun);
        const force = Boolean(args.force);

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

                if (!args.json && dryRun) {

                    logger.info('Dry run: rendering revert files to tmp/ (no DB writes)');

                }

                const res = await ctx.noorm.changes.revert(changeName, { dryRun, force });

                if (!args.json) {

                    if (res.status === 'success') {

                        const suffix = dryRun ? `${res.status}, dry-run` : res.status;
                        logger.info(`${res.name} reverted (${suffix})`);

                    }
                    else {

                        logger.error(`${res.name} revert (${res.status})`);
                        if (res.error) logger.error(`  error: ${res.error}`);

                        for (const file of res.files) {

                            if (file.status === 'failed') {

                                logger.error(`  ${file.filepath} (failed)`);
                                if (file.error) logger.error(`    error: ${file.error}`);

                            }

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

            const payload = dryRun ? { ...result, dryRun: true } : result;
            outputResult(args, payload, '');

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
