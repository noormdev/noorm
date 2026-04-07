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
            fn: (ctx, logger) => {

                return ctx.noorm.changes.history(count).then((records) => {

                    logger.info(`Execution History: ${records.length} records`);

                    for (const record of records) {

                        const date = new Date(record.executedAt).toLocaleString();
                        logger.info(`  ${record.name} - ${record.status} (${date})`);

                    }

                    return records;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, history, '');

        }

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
