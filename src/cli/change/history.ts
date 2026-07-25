/**
 * noorm change history — show change execution history.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const historyCommand = defineCommand({
    meta: {
        name: 'history',
        description: 'Show change execution history',
    },
    args: {
        count: {
            type: 'string',
            description: 'Show last N records (default: 20)',
            default: '20',
        },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const count = parseInt(args.count, 10);

        const [history, error] = await withContext({
            args,
            fn: (ctx) => ctx.noorm.changes.history(count),
        });

        if (error) process.exit(1);

        const text = [
            `Execution History: ${history.length} records`,
            ...history.map((record) => `  ${record.name} - ${record.status} (${new Date(record.executedAt).toLocaleString()})`),
        ].join('\n');

        outputResult(args, history, text);

        process.exit(0);

    },
});

(historyCommand as typeof historyCommand & { examples: string[] }).examples = [
    'noorm change history',
    'noorm change history --json',
    'noorm change history -c prod',
    'noorm change history --count 50',
];

export default historyCommand;
