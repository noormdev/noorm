/**
 * noorm change history-detail <name> — show per-file execution history for a change.
 *
 * Lists every operation record for the named change and the individual
 * SQL file results within each operation.
 *
 * If the name is omitted and stdin is a TTY, connects, fetches change
 * status, and prompts the user to pick from changes that have a history
 * record (anything beyond "pending"). Non-TTY callers must pass the name.
 */
import * as p from '@clack/prompts';
import { defineCommand } from 'citty';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';
import { selectChangeFromStatus, requireTty } from './_prompt.js';

const historyDetailCommand = defineCommand({
    meta: {
        name: 'history-detail',
        description: 'Show per-file execution history for a specific change',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Change name to inspect (omit to pick interactively on a TTY)',
            required: false,
        },
        count: {
            type: 'string',
            description: 'Show last N operation records (default: 10)',
            default: '10',
        },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        if (!args.name && !requireTty('Change name')) process.exit(1);

        const limit = parseInt(args.count, 10);

        const [result, error] = await withContext({
            args,
            fn: async (ctx, logger) => {

                let changeName = args.name;

                if (!changeName) {

                    const status = await ctx.noorm.changes.status();

                    const picked = await selectChangeFromStatus(status, {
                        message: 'Inspect which change?',
                        emptyMessage: 'No changes with history to inspect.',
                        filter: (c) => c.status !== 'pending',
                    });

                    if (!picked) {

                        p.cancel('No change selected.');
                        throw new Error('aborted');

                    }

                    changeName = picked;

                }

                const records = await ctx.noorm.changes.historyForChange(changeName, limit);

                if (records.length === 0) {

                    if (!args.json) {

                        logger.info(`No history found for change: ${changeName}`);

                    }

                    return { name: changeName, operations: [] };

                }

                const operations = await Promise.all(
                    records.map(async (record) => {

                        const files = await ctx.noorm.changes.getFileHistory(record.id);

                        return { record, files };

                    }),
                );

                if (!args.json) {

                    logger.info(`History for: ${changeName} (${records.length} operation(s))`);

                    for (const { record, files } of operations) {

                        const date = new Date(record.executedAt).toLocaleString();
                        logger.info(`\n  [${record.id}] ${record.direction} — ${record.status} at ${date} by ${record.executedBy}`);

                        if (record.durationMs) {

                            logger.info(`       duration: ${record.durationMs}ms`);

                        }

                        if (record.errorMessage) {

                            logger.info(`       error: ${record.errorMessage}`);

                        }

                        if (files.length > 0) {

                            for (const file of files) {

                                const fileLabel = file.filepath.split('/').pop() ?? file.filepath;
                                const parts = [`    • ${fileLabel} — ${file.status}`];

                                if (file.durationMs) {

                                    parts.push(`${file.durationMs}ms`);

                                }

                                if (file.errorMessage) {

                                    parts.push(`error: ${file.errorMessage}`);

                                }
                                else if (file.skipReason) {

                                    parts.push(`skipped: ${file.skipReason}`);

                                }

                                logger.info(parts.join(' | '));

                            }

                        }

                    }

                }

                return { name: changeName, operations };

            },
        });

        if (error) process.exit(1);

        if (!result) {

            outputError(args, 'No result returned');
            process.exit(1);

        }

        if (args.json) {

            outputResult(args, result, '');

        }

        process.exit(0);

    },
});

(historyDetailCommand as typeof historyDetailCommand & { examples: string[] }).examples = [
    'noorm change history-detail',
    'noorm change history-detail 001_init',
    'noorm change history-detail 2024-02-01-notifications -c prod',
    'noorm change history-detail 002_users --json',
    'noorm change history-detail 003_roles --count 5',
];

export default historyDetailCommand;
