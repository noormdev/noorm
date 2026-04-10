/**
 * noorm db explore views — list all views, with detail subcommand.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';

const viewsCommand = defineCommand({
    meta: {
        name: 'views',
        description: 'List views in the database',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Name of the view to describe',
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

                    return ctx.noorm.db.describeView(args.name as string, args.schema).then((res) => {

                        if (res && !args.json) {

                            logger.info(`View: ${res.name}`);
                            logger.info(`  Updatable: ${res.isUpdatable}`);

                            for (const col of res.columns) {

                                const nullable = col.isNullable ? 'nullable' : 'not null';
                                logger.info(`  ${col.name}: ${col.dataType} (${nullable})`);

                            }

                            if (res.definition) {

                                logger.info(`  Definition:\n${res.definition}`);

                            }

                        }

                        return res;

                    });

                },
            });

            if (error) process.exit(1);

            if (!detail) {

                outputError(args, `View not found: ${args.name}`);
                process.exit(1);

            }

            if (args.json) {

                outputResult(args, detail, '');

            }

            process.exit(0);

        }

        const [views, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.db.listViews().then((res) => {

                    if (!args.json) {

                        logger.info(`Views: ${res.length}`);

                        for (const v of res) {

                            const updatable = v.isUpdatable ? ' [updatable]' : '';
                            logger.info(`  ${v.name} (${v.columnCount} cols)${updatable}`);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, views, '');

        }

        process.exit(0);

    },
});

(viewsCommand as typeof viewsCommand & { examples: string[] }).examples = [
    'noorm db explore views',
    'noorm db explore views --json',
    'noorm db explore views active_users',
    'noorm db explore views active_users --schema public',
];

export default viewsCommand;
