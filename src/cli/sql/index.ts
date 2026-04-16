/**
 * noorm sql — SQL execution and history management.
 *
 * Bare `noorm sql "SELECT 1"` delegates to the query subcommand.
 * Explicit subcommands: query, history, clear.
 */
import { readFile } from 'node:fs/promises';

import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import { executeRawSql } from '../../core/sql-terminal/executor.js';
import { withContext, outputError, outputResult, sharedArgs } from '../_utils.js';

import query from './query.js';
import history from './history.js';
import clear from './clear.js';
import repl from './repl.js';

const sqlCommand = defineCommand({
    meta: {
        name: 'sql',
        description: 'Execute SQL and manage query history',
    },
    args: {
        query: { type: 'positional', description: 'SQL query to execute', required: false },
        file: { type: 'string', description: 'Read SQL from a file', alias: 'f' },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    subCommands: { query: query, history, clear, repl },
    async run({ args }) {

        let sql = args.query;

        if (args.file) {

            const [content, readErr] = await attempt(() => readFile(args.file!, 'utf-8'));

            if (readErr) {

                outputError(args, `Failed to read SQL file: ${args.file}: ${readErr.message}`);
                process.exit(1);

            }

            sql = content.trim();

        }

        if (!sql) {

            outputError(args, 'No query provided. Usage: noorm sql "SELECT ..." or noorm sql query "SELECT ..."');
            process.exit(1);

        }

        const [result, error] = await withContext({
            args,
            fn: async (ctx) => executeRawSql(ctx.kysely as unknown as Kysely<unknown>, sql!, args.config ?? 'default'),
        });

        if (error) process.exit(1);

        if (!result.success) {

            outputError(args, `Query failed: ${result.errorMessage}`);
            process.exit(1);

        }

        if (args.json) {

            outputResult(args, result, '');

        }
        else {

            const rowCount = result.rows?.length ?? 0;

            if (result.rows && result.rows.length > 0) {

                process.stdout.write(`Columns: ${result.columns?.join(', ')}\n`);

                for (const row of result.rows) {

                    process.stdout.write(JSON.stringify(row) + '\n');

                }

            }

            if (result.rowsAffected !== undefined) {

                process.stdout.write(`Rows affected: ${result.rowsAffected}\n`);

            }
            else {

                process.stdout.write(`${rowCount} row${rowCount !== 1 ? 's' : ''} returned (${Math.round(result.durationMs)}ms)\n`);

            }

        }

        process.exit(0);

    },
});

(sqlCommand as typeof sqlCommand & { examples: string[] }).examples = [
    'noorm sql "SELECT 1"',
    'noorm sql -f query.sql',
    'noorm sql history',
    'noorm sql repl',
    'noorm sql repl --config dev',
];

export default sqlCommand;
