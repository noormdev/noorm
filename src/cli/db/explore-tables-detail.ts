/**
 * noorm db explore tables detail — describe a specific table.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';

const detailCommand = defineCommand({
    meta: {
        name: 'detail',
        description: 'Describe a specific table',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Name of the table to describe',
            required: true,
        },
        schema: {
            type: 'string',
            description: 'Schema name',
        },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [detail, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.db.describeTable(args.name, args.schema).then((res) => {

                    if (res && !args.json) {

                        logger.info(`Table: ${res.name}`);

                        for (const col of res.columns) {

                            const nullable = col.isNullable ? 'nullable' : 'not null';
                            const pk = col.isPrimaryKey ? ' [PK]' : '';
                            logger.info(`  ${col.name}: ${col.dataType} (${nullable})${pk}`);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (!detail) {

            outputError(args, `Table not found: ${args.name}`);
            process.exit(1);

        }

        if (args.json) {

            outputResult(args, detail, '');

        }

        process.exit(0);

    },
});

(detailCommand as typeof detailCommand & { examples: string[] }).examples = [
    'noorm db explore tables detail users',
    'noorm db explore tables detail posts --json',
    'noorm db explore tables detail orders --schema myschema',
];

export default detailCommand;
