/**
 * noorm change rewind <name> — revert applied changes back to a named change.
 *
 * Reverts changes in reverse order of application until and including
 * the named change. This is the inverse of `change ff`.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const rewindCommand = defineCommand({
    meta: {
        name: 'rewind',
        description: 'Revert applied changes back to (and including) a named change',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Change name to revert to',
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

                return ctx.noorm.changes.rewind(args.name).then((res) => {

                    if (!args.json) {

                        logger.info(`Rewind: ${res.status} (${res.executed} reverted, ${res.failed} failed)`);

                        for (const change of res.changes) {

                            logger.info(`  ${change.name} — ${change.status}`);

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

        process.exit(result.status === 'failed' ? 2 : 0);

    },
});

(rewindCommand as typeof rewindCommand & { examples: string[] }).examples = [
    'noorm change rewind 001_init',
    'noorm change rewind 2024-02-01-notifications -c prod',
    'noorm change rewind 002_users --json',
    'noorm change rewind 003_roles --dry-run',
];

export default rewindCommand;
