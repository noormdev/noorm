/**
 * noorm change run <name> — apply a single named change.
 *
 * If the name is omitted and stdin is a TTY, connects, fetches change
 * status, and prompts the user to pick from pending/reverted changes.
 * Non-TTY callers must pass the name or the command errors out.
 */
import * as p from '@clack/prompts';
import { defineCommand } from 'citty';

import { isPendingChange } from '../../core/change/index.js';
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

        const dryRun = Boolean(args.dryRun);
        const force = Boolean(args.force);

        const [result, error] = await withContext({
            args,
            fn: async (ctx, logger) => {

                let changeName = args.name;

                if (!changeName) {

                    const status = await ctx.noorm.changes.status();

                    const picked = await selectChangeFromStatus(status, {
                        message: 'Pick a change to apply',
                        emptyMessage: 'No pending changes to apply.',
                        filter: isPendingChange,
                    });

                    if (!picked) {

                        p.cancel('No change selected.');
                        throw new Error('aborted');

                    }

                    changeName = picked;

                }

                if (!args.json && dryRun) {

                    logger.info('Dry run: rendering change to tmp/ (no DB writes)');

                }

                const res = await ctx.noorm.changes.apply(changeName, { dryRun, force });

                if (!args.json) {

                    if (res.status === 'success') {

                        const suffix = dryRun ? `${res.status}, dry-run` : res.status;
                        logger.info(`${res.name} (${suffix})`);

                    }
                    else {

                        logger.error(`${res.name} (${res.status})`);
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

(runCommand as typeof runCommand & { examples: string[] }).examples = [
    'noorm change run',
    'noorm change run 001_init',
    'noorm change run 002_users -c prod',
    'noorm change run 2024-02-01-notifications --json',
];

export default runCommand;
