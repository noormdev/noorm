/**
 * noorm db explore fks — list all foreign keys.
 */
import { defineCommand } from 'citty';

import type { Kysely } from 'kysely';

import { fetchList } from '../../core/explore/index.js';
import { withContext, outputResult, sharedArgs } from '../_utils.js';

const fksCommand = defineCommand({
    meta: {
        name: 'fks',
        description: 'List foreign keys in the database',
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

        const [fks, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                // Core rather than the SDK: the SDK's list methods take no
                // options, so --schema cannot reach the query through them.
                return fetchList(ctx.kysely as Kysely<unknown>, ctx.dialect, 'foreignKeys', { schema: args.schema }).then((res) => {

                    if (!args.json) {

                        logger.info(`Foreign Keys: ${res.length}`);

                        for (const fk of res) {

                            const table = fk.tableSchema ? `${fk.tableSchema}.${fk.tableName}` : fk.tableName;
                            const src = `${table}(${fk.columns.join(', ')})`;
                            const ref = `${fk.referencedTable}(${fk.referencedColumns.join(', ')})`;
                            const actions: string[] = [];

                            if (fk.onDelete) {

                                actions.push(`ON DELETE ${fk.onDelete}`);

                            }

                            if (fk.onUpdate) {

                                actions.push(`ON UPDATE ${fk.onUpdate}`);

                            }

                            const actionStr = actions.length > 0 ? ` [${actions.join(', ')}]` : '';
                            logger.info(`  ${fk.name}: ${src} → ${ref}${actionStr}`);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, { foreignKeys: fks }, '');

        }

        process.exit(0);

    },
});

(fksCommand as typeof fksCommand & { examples: string[] }).examples = [
    'noorm db explore fks',
    'noorm db explore fks --json',
    'noorm db explore fks --schema app',
];

export default fksCommand;
