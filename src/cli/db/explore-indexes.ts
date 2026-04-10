/**
 * noorm db explore indexes — list all indexes.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const indexesCommand = defineCommand({
    meta: {
        name: 'indexes',
        description: 'List indexes in the database',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [indexes, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.db.listIndexes().then((res) => {

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
                            logger.info(`  ${idx.name} on ${idx.tableName} (${idx.columns.join(', ')})${flagStr}`);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, indexes, '');

        }

        process.exit(0);

    },
});

(indexesCommand as typeof indexesCommand & { examples: string[] }).examples = [
    'noorm db explore indexes',
    'noorm db explore indexes --json',
];

export default indexesCommand;
