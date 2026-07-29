/**
 * noorm db explore indexes — list all indexes.
 */
import { defineCommand } from 'citty';

import type { Kysely } from 'kysely';

import { fetchList } from '../../core/explore/index.js';
import { withContext, outputResult, sharedArgs } from '../_utils.js';

const indexesCommand = defineCommand({
    meta: {
        name: 'indexes',
        description: 'List indexes in the database',
    },
    args: {
        schema: {
            type: 'string',
            description: 'Restrict the listing to one schema',
        },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [indexes, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                // Core rather than the SDK: the SDK's list methods take no
                // options, so --schema cannot reach the query through them.
                return fetchList(ctx.kysely as Kysely<unknown>, ctx.dialect, 'indexes', { schema: args.schema }).then((res) => {

                    if (!args.json) {

                        logger.info(`Indexes: ${res.length}`);

                        for (const idx of res) {

                            const flags: string[] = [];

                            if (idx.isPrimary) {

                                flags.push('PRIMARY');

                            }
                            else if (idx.isUnique) {

                                flags.push('UNIQUE');

                            }

                            const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
                            const table = idx.tableSchema ? `${idx.tableSchema}.${idx.tableName}` : idx.tableName;
                            logger.info(`  ${idx.name} on ${table} (${idx.columns.join(', ')})${flagStr}`);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, { indexes }, '');

        }

        process.exit(0);

    },
});

(indexesCommand as typeof indexesCommand & { examples: string[] }).examples = [
    'noorm db explore indexes',
    'noorm db explore indexes --json',
    'noorm db explore indexes --schema app',
];

export default indexesCommand;
