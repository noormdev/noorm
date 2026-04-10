/**
 * noorm db explore procedures — list all stored procedures, with detail view.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';

const proceduresCommand = defineCommand({
    meta: {
        name: 'procedures',
        description: 'List stored procedures in the database',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Name of the procedure to describe',
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

                    return ctx.noorm.db.describeProcedure(args.name as string, args.schema).then((res) => {

                        if (res && !args.json) {

                            logger.info(`Procedure: ${res.name}`);

                            for (const param of res.parameters) {

                                logger.info(`  ${param.name}: ${param.dataType} (${param.mode})`);

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

                outputError(args, `Procedure not found: ${args.name}`);
                process.exit(1);

            }

            if (args.json) {

                outputResult(args, detail, '');

            }

            process.exit(0);

        }

        const [procedures, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.db.listProcedures().then((res) => {

                    if (!args.json) {

                        logger.info(`Procedures: ${res.length}`);

                        for (const p of res) {

                            logger.info(`  ${p.name} (${p.parameterCount} params)`);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, procedures, '');

        }

        process.exit(0);

    },
});

(proceduresCommand as typeof proceduresCommand & { examples: string[] }).examples = [
    'noorm db explore procedures',
    'noorm db explore procedures --json',
    'noorm db explore procedures sp_update_user',
    'noorm db explore procedures sp_update_user --schema dbo',
];

export default proceduresCommand;
