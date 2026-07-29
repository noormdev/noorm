/**
 * noorm change next — apply the next pending change.
 *
 * Applies one change at a time for controlled, step-by-step migration.
 * Pass a count argument to apply multiple pending changes.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const nextCommand = defineCommand({
    meta: {
        name: 'next',
        description: 'Apply the next pending change(s)',
    },
    args: {
        count: {
            type: 'positional',
            description: 'Number of pending changes to apply (default: 1)',
            required: false,
        },
        config: sharedArgs.config,
        force: sharedArgs.force,
        dryRun: sharedArgs.dryRun,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const count = args.count ? parseInt(args.count, 10) : 1;
        const dryRun = Boolean(args.dryRun);
        const force = Boolean(args.force);

        if (isNaN(count) || count < 1) {

            process.stderr.write('Error: count must be a positive integer\n');
            process.exit(1);

        }

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.changes.next(count, { dryRun, force }).then((res) => {

                    if (!args.json) {

                        if (dryRun) {

                            logger.info('Dry run: rendering changes to tmp/ (no DB writes)');

                        }

                        // Warned, not failed: without this an absent changes/
                        // directory reads exactly like an up-to-date database.
                        for (const warning of res.warnings ?? []) {

                            logger.warn(warning);

                        }

                        if (res.executed === 0) {

                            logger.info('No pending changes to apply.');

                        }
                        else {

                            const label = dryRun ? 'Rendered' : 'Applied';

                            logger.info(`${label} ${res.executed} change(s)`, {
                                executed: res.executed,
                                skipped: res.skipped,
                                failed: res.failed,
                                ...(dryRun ? { dryRun: true } : {}),
                            });

                            for (const cs of res.changes) {

                                const suffix = dryRun ? `${cs.status}, dry-run` : cs.status;
                                logger.info(`  ${cs.name} (${suffix})`);

                            }

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            const payload = dryRun ? { ...result, dryRun: true } : result;
            outputResult(args, payload, '');

        }

        process.exit(result.status === 'success' ? 0 : 2);

    },
});

(nextCommand as typeof nextCommand & { examples: string[] }).examples = [
    'noorm change next',
    'noorm change next 3',
    'noorm change next --dry-run',
    'noorm change next -c prod',
    'noorm change next --json',
];

export default nextCommand;
