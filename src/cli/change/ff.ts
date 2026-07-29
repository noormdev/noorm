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

        const dryRun = Boolean(args.dryRun);
        const force = Boolean(args.force);

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.changes.ff({ dryRun, force }).then((res) => {

                    if (!args.json) {

                        if (dryRun) {

                            logger.info('Dry run: rendering changes to tmp/ (no DB writes)');

                        }

                        // Warned, not failed: without this an absent changes/
                        // directory reads exactly like an up-to-date database.
                        for (const warning of res.warnings ?? []) {

                            logger.warn(warning);

                        }

                        const summary = {
                            executed: res.executed,
                            skipped: res.skipped,
                            failed: res.failed,
                            ...(dryRun ? { dryRun: true } : {}),
                        };

                        const headerPrefix = dryRun ? 'Fast-forward (dry-run)' : 'Fast-forward';

                        if (res.status === 'success') {

                            logger.info(`${headerPrefix} ${res.status}`, summary);

                        }
                        else {

                            logger.error(`${headerPrefix} ${res.status}`, summary);

                        }

                        for (const cs of res.changes) {

                            if (cs.status === 'failed') {

                                logger.error(`  ${cs.name} (failed)`);
                                if (cs.error) logger.error(`    error: ${cs.error}`);

                            }
                            else {

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

            // Annotate the JSON payload with the dry-run flag so callers in
            // CI pipelines can detect that the result didn't touch the DB
            // without having to also parse the surrounding human output.
            const payload = dryRun ? { ...result, dryRun: true } : result;
            outputResult(args, payload, '');

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
