/**
 * noorm db explore triggers — list triggers, with detail view.
 *
 * Triggers were implemented in core and counted in the overview, but only
 * reachable over RPC/MCP, so the CLI reported a number for something it had
 * no way to show.
 */
import { defineCommand } from 'citty';

import type { Kysely } from 'kysely';

import { fetchList, fetchDetail } from '../../core/explore/index.js';
import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

const triggersCommand = defineCommand({
    meta: {
        name: 'triggers',
        description: 'List triggers in the database',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Name of the trigger to describe',
            required: false,
        },
        schema: {
            type: 'string',
            description: 'Restrict the listing to one schema',
        },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        if (args.name) {

            const [detail, error] = await withContext({
                args,
                fn: (ctx, logger) => {

                    return fetchDetail(
                        ctx.kysely as Kysely<unknown>,
                        ctx.dialect,
                        'triggers',
                        args.name as string,
                        args.schema,
                    ).then((res) => {

                        if (res && !args.json) {

                            logger.info(`Trigger: ${res.name}`);
                            logger.info(`  Table: ${res.tableSchema ? `${res.tableSchema}.` : ''}${res.tableName}`);
                            logger.info(`  Timing: ${res.timing} ${res.events.join('/')}`);
                            logger.info(`  Enabled: ${res.isEnabled}`);

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

                outputError(args, `Trigger not found: ${args.name}`);
                process.exit(EXIT.USAGE);

            }

            if (args.json) {

                outputResult(args, detail, '');

            }

            process.exit(0);

        }

        const [triggers, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return fetchList(ctx.kysely as Kysely<unknown>, ctx.dialect, 'triggers', { schema: args.schema }).then((res) => {

                    if (!args.json) {

                        logger.info(`Triggers: ${res.length}`);

                        for (const t of res) {

                            const table = t.tableSchema ? `${t.tableSchema}.${t.tableName}` : t.tableName;
                            logger.info(`  ${t.name}: ${t.timing} ${t.events.join('/')} on ${table}`);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, { triggers }, '');

        }

        process.exit(0);

    },
});

(triggersCommand as typeof triggersCommand & { examples: string[] }).examples = [
    'noorm db explore triggers',
    'noorm db explore triggers --json',
    'noorm db explore triggers --schema app',
    'noorm db explore triggers audit_users',
];

export default triggersCommand;
