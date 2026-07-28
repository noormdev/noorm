/**
 * noorm change list — list every known change with its status.
 *
 * This was previously the default behavior of bare `noorm change`. It
 * moved to an explicit subcommand so the parent `change` command can
 * render help like every other multi-command root (`config`, `vault`,
 * `identity`, …) without connecting to the database unnecessarily.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const listCommand = defineCommand({
    meta: {
        name: 'list',
        description: 'List every known change with its status',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [changes, error] = await withContext({
            args,
            fn: (ctx) => ctx.noorm.changes.status(),
        });

        if (error) process.exit(1);

        const pending = changes.filter((c) => c.status === 'pending').length;

        const text = changes.length === 0
            ? 'No changes found.'
            : [
                ...changes.map((cs) => `${cs.name} (${cs.status})`),
                ...(pending > 0 ? [`${pending} pending change(s)`] : []),
            ].join('\n');

        outputResult(args, changes, text);

        process.exit(0);

    },
});

(listCommand as typeof listCommand & { examples: string[] }).examples = [
    'noorm change list',
    'noorm change list --json',
    'noorm change list -c staging',
];

export default listCommand;
