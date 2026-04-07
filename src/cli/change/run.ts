/**
 * noorm change run <name> — apply a single named change.
 */
import { defineCommand } from 'citty';

import { withContext, sharedArgs } from '../_utils.js';

const runCommand = defineCommand({
    meta: {
        name: 'run',
        description: 'Apply a specific change by name',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Change name to apply',
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

                return ctx.noorm.changes.apply(args.name).then((res) => {

                    logger.info(`${res.name} (${res.status})`);
                    return res;

                });

            },
        });

        if (error) process.exit(1);

        process.exit(result.status === 'success' ? 0 : 2);

    },
});

(runCommand as typeof runCommand & { examples: string[] }).examples = [
    'noorm change run 001_init',
    'noorm change run 002_users -c prod',
    'noorm change run 2024-02-01-notifications --json',
];

export default runCommand;
