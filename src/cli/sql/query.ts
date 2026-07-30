/**
 * noorm sql <query> — execute a raw SQL query.
 */
import { readFile } from 'node:fs/promises';

import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import { resolveChannel } from '../../core/policy/index.js';
import { executeRawSql } from '../../core/sql-terminal/executor.js';
import { withContext, outputError, outputResult, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

const sqlCommand = defineCommand({
    meta: {
        name: 'sql',
        description: 'Execute a raw SQL query',
    },
    args: {
        query: { type: 'positional', description: 'SQL query to execute', required: false },
        file: { type: 'string', description: 'Read SQL from a file', alias: 'f' },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        let query = args.query;

        if (args.file) {

            const [content, readErr] = await attempt(() => readFile(args.file!, 'utf-8'));

            if (readErr) {

                outputError(args, `Failed to read SQL file: ${args.file}: ${readErr.message}`);
                process.exit(EXIT.USAGE);

            }

            query = content.trim();

        }

        if (!query) {

            outputError(args, 'No query provided. Usage: noorm sql "SELECT ..."');
            process.exit(EXIT.USAGE);

        }

        const [result, error] = await withContext({
            args,
            fn: async (ctx) => executeRawSql(ctx.kysely as unknown as Kysely<unknown>, query!, ctx.noorm.config.name, {
                access: ctx.noorm.config.access,
                channel: resolveChannel(),
                dialect: ctx.dialect,
            }),
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

// The bare `noorm sql <SQL>` form works only when the first token after
// `sql` is the query itself — the argv rewriter in `src/cli/index.ts` looks
// for SQL there, and for `-c prod` / `-f file.sql` it finds the flag's value
// instead, so no `query` subcommand is inserted and citty prints help. Those
// two forms are shown explicitly rather than teaching a command that exits
// on the help screen.
(sqlCommand as typeof sqlCommand & { examples: string[] }).examples = [
    'noorm sql "SELECT 1"',
    'noorm sql "SELECT * FROM users LIMIT 10"',
    'noorm sql query -c prod "SELECT count(*) FROM orders"',
    'noorm sql --json "SELECT id, name FROM users"',
    'noorm sql query -f reports/monthly.sql',
];

export default sqlCommand;
