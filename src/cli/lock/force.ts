/**
 * noorm lock force — force release any database lock regardless of ownership.
 *
 * Breaking a lock interrupts whatever migration its holder is running, so the
 * config's `lock:force` access gates it (enforced at the SDK seam in
 * `lock.forceRelease`, shared with the TUI and MCP) and `--yes` is the
 * confirmation. Exits `EXIT.USAGE` when there was nothing to release, so a
 * script can tell "evicted a holder" apart from "no-op" without parsing text.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

const forceCommand = defineCommand({
    meta: {
        name: 'force',
        description: 'Force release the database lock regardless of ownership',
    },
    args: {
        config: sharedArgs.config,
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [result, error] = await withContext({
            args,
            fn: async (ctx, logger) => {

                const outcome = await ctx.noorm.lock.forceRelease();

                if (!args.json) {

                    // Naming the evicted holder is the point: a silent steal
                    // gives the operator no way to warn whoever they cut off.
                    logger.info(
                        outcome.released
                            ? `Lock force-released (was held by ${outcome.holder})`
                            : 'No lock to release',
                    );

                }

                return outcome;

            },
        });

        if (error) process.exit(EXIT.FAILURE);

        if (args.json) {

            // `success` tracks whether a lock was actually broken, not whether
            // the command ran — "released: false" is a no-op, and the envelope
            // must not call a no-op a success.
            outputResult(
                args,
                { success: result.released, released: result.released, holder: result.holder, forced: true },
                '',
            );

        }

        // Nothing to release is the "named target does not exist" case: the
        // command changed nothing, so it reports USAGE rather than success.
        process.exit(result.released ? EXIT.SUCCESS : EXIT.USAGE);

    },
});

(forceCommand as typeof forceCommand & { examples: string[] }).examples = [
    'noorm lock force --yes',
    'noorm lock force -c prod --yes',
    'noorm lock force --yes --json',
];

export default forceCommand;
