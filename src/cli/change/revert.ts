/**
 * noorm change revert <name> — revert a single applied change.
 */
import { defineCommand } from 'citty';

import { withContext, sharedArgs } from '../_utils.js';

const revertCommand = defineCommand({
    meta: {
        name: 'revert',
        description: 'Revert a specific change by name',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Change name to revert',
            required: true,
        },
        config: sharedArgs.config,
        force: sharedArgs.force,
        dryRun: sharedArgs.dryRun,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.changes.revert(args.name).then((res) => {

                    logger.info(`${res.name} reverted (${res.status})`);
                    return res;

                });

            },
        });

        if (error) process.exit(1);

        process.exit(result.status === 'success' ? 0 : 2);

    },
});

(revertCommand as typeof revertCommand & { examples: string[] }).examples = [
    'noorm change revert 001_init',
    'noorm change revert 002_users -c prod',
    'noorm change revert 002_users --json',
];

export default revertCommand;
