/**
 * noorm lock force — force release any database lock regardless of ownership.
 *
 * Breaking a lock interrupts whatever migration its holder is running, so the
 * config's `lock:force` access gates it (enforced at the SDK seam in
 * `lock.forceRelease`, shared with the TUI and MCP) and `--yes` is the
 * confirmation. Exits 2 when there was nothing to release, so a script can
 * tell "evicted a holder" apart from "no-op" without parsing text.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

/** Exit code for "command succeeded, but there was no lock to release". */
const EXIT_NOTHING_TO_RELEASE = 2;

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

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, { released: result.released, holder: result.holder, forced: true }, '');

        }

        process.exit(result.released ? 0 : EXIT_NOTHING_TO_RELEASE);

    },
});

(forceCommand as typeof forceCommand & { examples: string[] }).examples = [
    'noorm lock force --yes',
    'noorm lock force -c prod --yes',
    'noorm lock force --yes --json',
];

export default forceCommand;
