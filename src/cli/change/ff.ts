/**
 * noorm change ff — fast-forward apply all pending changes.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const ffCommand = defineCommand({
    meta: {
        name: 'ff',
        description: 'Fast-forward: apply all pending changes',
    },
    args: {
        config: sharedArgs.config,
        force: sharedArgs.force,
        dryRun: sharedArgs.dryRun,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.changes.ff().then((res) => {

                    logger.info(`Fast-forward ${res.status}`, {
                        executed: res.executed,
                        skipped: res.skipped,
                        failed: res.failed,
                    });
                    for (const cs of res.changes) {

                        logger.info(`  ${cs.name} (${cs.status})`);

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, result, '');

        }

        process.exit(result.status === 'success' ? 0 : 2);

    },
});

(ffCommand as typeof ffCommand & { examples: string[] }).examples = [
    'noorm change ff',
    'noorm change ff -c prod',
    'noorm change ff --dry-run',
    'noorm change ff --force',
];

export default ffCommand;
