/**
 * noorm db explore tables — list all tables, with detail subcommand.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

import detail from './explore-tables-detail.js';

const tablesCommand = defineCommand({
    meta: {
        name: 'tables',
        description: 'List tables in the database',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    subCommands: { detail },
    async run({ args }) {

        const [tables, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.db.listTables().then((res) => {

                    logger.info(`Tables: ${res.length}`);
                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, tables, '');

        }

        process.exit(0);

    },
});

(tablesCommand as typeof tablesCommand & { examples: string[] }).examples = [
    'noorm db explore tables',
    'noorm db explore tables --json',
    'noorm db explore tables detail users',
];

export default tablesCommand;
