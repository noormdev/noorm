/**
 * noorm db explore tables — list all tables, with detail subcommand.
 */
import { defineCommand } from 'citty';

import type { Kysely } from 'kysely';

import { fetchList } from '../../core/explore/index.js';
import { withContext, outputResult, sharedArgs } from '../_utils.js';

import detail from './explore-tables-detail.js';

const tablesCommand = defineCommand({
    meta: {
        name: 'tables',
        description: 'List tables in the database',
    },
    args: {
        schema: {
            type: 'string',
            description: 'Restrict the listing to one schema',
        },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    subCommands: { detail },
    async run({ args }) {

        const [tables, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                // Core rather than the SDK: the SDK's list methods take no
                // options, so --schema cannot reach the query through them.
                return fetchList(ctx.kysely as Kysely<unknown>, ctx.dialect, 'tables', { schema: args.schema }).then((res) => {

                    if (!args.json) {

                        logger.info(`Tables: ${res.length}`);

                        for (const t of res) {

                            const qualified = t.schema ? `${t.schema}.${t.name}` : t.name;
                            logger.info(`  ${qualified} (${t.columnCount} cols)`);

                        }

                    }

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
    'noorm db explore tables --schema app',
    'noorm db explore tables detail users',
];

export default tablesCommand;
