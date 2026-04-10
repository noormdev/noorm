/**
 * noorm db explore fks — list all foreign keys.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const fksCommand = defineCommand({
    meta: {
        name: 'fks',
        description: 'List foreign keys in the database',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [fks, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.db.listForeignKeys().then((res) => {

                    if (!args.json) {

                        logger.info(`Foreign Keys: ${res.length}`);

                        for (const fk of res) {

                            const src = `${fk.tableName}(${fk.columns.join(', ')})`;
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

            outputResult(args, fks, '');

        }

        process.exit(0);

    },
});

(fksCommand as typeof fksCommand & { examples: string[] }).examples = [
    'noorm db explore fks',
    'noorm db explore fks --json',
];

export default fksCommand;
