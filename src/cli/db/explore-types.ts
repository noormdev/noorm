/**
 * noorm db explore types — list all custom types, with detail view.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';

const typesCommand = defineCommand({
    meta: {
        name: 'types',
        description: 'List custom types in the database',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Name of the type to describe',
            required: false,
        },
        schema: {
            type: 'string',
            description: 'Schema name',
        },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        if (args.name) {

            const [detail, error] = await withContext({
                args,
                fn: (ctx, logger) => {

                    return ctx.noorm.db.describeType(args.name as string, args.schema).then((res) => {

                        if (res && !args.json) {

                            logger.info(`Type: ${res.name} (${res.kind})`);

                            if (res.values && res.values.length > 0) {

                                logger.info(`  Values: ${res.values.join(', ')}`);

                            }

                            if (res.attributes && res.attributes.length > 0) {

                                for (const attr of res.attributes) {

                                    logger.info(`  ${attr.name}: ${attr.dataType}`);

                                }

                            }

                            if (res.baseType) {

                                logger.info(`  Base type: ${res.baseType}`);

                            }

                        }

                        return res;

                    });

                },
            });

            if (error) process.exit(1);

            if (!detail) {

                outputError(args, `Type not found: ${args.name}`);
                process.exit(1);

            }

            if (args.json) {

                outputResult(args, detail, '');

            }

            process.exit(0);

        }

        const [types, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.db.listTypes().then((res) => {

                    if (!args.json) {

                        logger.info(`Types: ${res.length}`);

                        for (const t of res) {

                            const extra = t.valueCount !== undefined ? ` (${t.valueCount} values)` : '';
                            logger.info(`  ${t.name} [${t.kind}]${extra}`);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, types, '');

        }

        process.exit(0);

    },
});

(typesCommand as typeof typesCommand & { examples: string[] }).examples = [
    'noorm db explore types',
    'noorm db explore types --json',
    'noorm db explore types user_status',
    'noorm db explore types user_status --schema public',
];

export default typesCommand;
