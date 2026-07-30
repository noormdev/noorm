/**
 * noorm db truncate — wipe all data, keep schema.
 *
 * Gated by the config's `db:truncate` access, enforced at the SDK seam that
 * `withContext` threads `--yes` into. `--dry-run` previews the statements
 * without executing them.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const truncateCommand = defineCommand({
    meta: {
        name: 'truncate',
        description: 'Wipe all data, keep schema',
    },
    args: {
        config: sharedArgs.config,
        dryRun: sharedArgs.dryRun,
        preserve: {
            type: 'string',
            description: 'Comma-separated tables to leave untouched',
        },
        only: {
            type: 'string',
            description: 'Comma-separated tables to truncate, to the exclusion of all others',
        },
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const dryRun = Boolean(args.dryRun);

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.db.truncate({
                    dryRun,
                    preserve: splitList(args.preserve),
                    only: splitList(args.only),
                }).then((res) => {

                    if (!args.json) {

                        const verb = dryRun ? 'Would truncate' : 'Truncated';

                        logger.info(`${verb} ${res.truncated.length} tables`);

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, {
                truncated: result.truncated,
                preserved: result.preserved,
                count: result.truncated.length,
                ...(dryRun ? { dryRun: true, statements: result.statements } : {}),
            }, '');

        }

        process.exit(0);

    },
});

/** Parses a comma-separated CLI list, returning undefined for an absent flag so the SDK's settings fallback still applies. */
function splitList(value: unknown): string[] | undefined {

    if (typeof value !== 'string' || value.trim().length === 0) return undefined;

    return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

}

(truncateCommand as typeof truncateCommand & { examples: string[] }).examples = [
    'noorm db truncate --yes',
    'noorm db truncate --dry-run',
    'noorm db truncate --preserve seeds,lookups --yes',
    'noorm db truncate --only users,posts --yes',
    'noorm db truncate --json --yes',
];

export default truncateCommand;
