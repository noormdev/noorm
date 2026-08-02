/**
 * noorm db teardown — drop all database objects.
 *
 * Gated by the config's `db:teardown` access, enforced at the SDK seam that
 * `withContext` threads `--yes` into.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';

const teardownCommand = defineCommand({
    meta: {
        name: 'teardown',
        description: 'Drop all database objects',
    },
    args: {
        config: sharedArgs.config,
        dryRun: sharedArgs.dryRun,
        preserveSchemas: {
            type: 'string',
            description: 'Comma-separated schemas to leave untouched (teardown reaches every non-system schema)',
        },
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const dryRun = Boolean(args.dryRun);
        const preserveSchemas = splitList(args.preserveSchemas);

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.db.teardown({ dryRun, preserveSchemas }).then((res) => {

                    const droppedCount = res.dropped.tables.length +
                        res.dropped.views.length +
                        res.dropped.functions.length +
                        res.dropped.types.length;

                    if (!args.json) {

                        const verb = dryRun ? 'Would drop' : 'Dropped';

                        logger.info(`${verb} ${droppedCount} objects`);
                        logger.info(`  Tables: ${res.dropped.tables.length}`);
                        logger.info(`  Views: ${res.dropped.views.length}`);
                        logger.info(`  Functions: ${res.dropped.functions.length}`);
                        logger.info(`  Types: ${res.dropped.types.length}`);

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        const droppedCount = result.dropped.tables.length +
            result.dropped.views.length +
            result.dropped.functions.length +
            result.dropped.types.length;

        const postScript = result.postScriptResult;

        // Decided before the payload is written: toJsonEnvelope defaults
        // `success` to true when the payload carries neither `success` nor
        // `status`, so the JSON claimed success while the process exited 1.
        const postScriptFailed = Boolean(postScript && !postScript.executed);

        if (args.json) {

            outputResult(args, {
                success: !postScriptFailed,
                dropped: result.dropped,
                count: droppedCount,
                ...(postScript ? { postScriptResult: postScript } : {}),
                ...(dryRun ? { dryRun: true } : {}),
            }, '');

        }

        // The objects are already gone, so this is not a rollback — but a
        // teardown whose post-script never ran is half-finished, and exiting
        // 0 told every pipeline it was complete.
        if (postScriptFailed) {

            if (!args.json) {

                outputError(args, `Post-teardown script failed: ${postScript?.error ?? 'Unknown error'}`);

            }

            process.exit(1);

        }

        process.exit(0);

    },
});

/** Parses a comma-separated CLI list, returning undefined for an absent flag. */
function splitList(value: unknown): string[] | undefined {

    if (typeof value !== 'string' || value.trim().length === 0) return undefined;

    return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

}

(teardownCommand as typeof teardownCommand & { examples: string[] }).examples = [
    'noorm db teardown --yes',
    'noorm db teardown --dry-run',
    'noorm db teardown --preserve-schemas app_private --yes',
    'noorm db teardown --json --yes',
];

export default teardownCommand;
