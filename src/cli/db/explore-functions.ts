/**
 * noorm db explore functions — list all functions, with detail view.
 */
import { defineCommand } from 'citty';

import type { Kysely } from 'kysely';

import { fetchList } from '../../core/explore/index.js';
import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

const functionsCommand = defineCommand({
    meta: {
        name: 'functions',
        description: 'List functions in the database',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Name of the function to describe',
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

                    return ctx.noorm.db.describeFunction(args.name as string, args.schema).then((res) => {

                        if (res && !args.json) {

                            logger.info(`Function: ${res.name}`);
                            logger.info(`  Returns: ${res.returnType}`);

                            if (res.language) {

                                logger.info(`  Language: ${res.language}`);

                            }

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

                outputError(args, `Function not found: ${args.name}`);
                process.exit(EXIT.USAGE);

            }

            if (args.json) {

                outputResult(args, detail, '');

            }

            process.exit(0);

        }

        const [functions, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                // Core rather than the SDK: the SDK's list methods take no
                // options, so --schema cannot reach the query through them.
                return fetchList(ctx.kysely as Kysely<unknown>, ctx.dialect, 'functions', { schema: args.schema }).then((res) => {

                    if (!args.json) {

                        logger.info(`Functions: ${res.length}`);

                        for (const f of res) {

                            const qualified = f.schema ? `${f.schema}.${f.name}` : f.name;
                            logger.info(`  ${qualified} (${f.parameterCount} params) → ${f.returnType}`);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, { functions }, '');

        }

        process.exit(0);

    },
});

(functionsCommand as typeof functionsCommand & { examples: string[] }).examples = [
    'noorm db explore functions',
    'noorm db explore functions --json',
    'noorm db explore functions --schema app',
    'noorm db explore functions fn_get_user',
    'noorm db explore functions fn_get_user --schema public',
];

export default functionsCommand;
