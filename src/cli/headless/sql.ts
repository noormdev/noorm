/**
 * Headless SQL command.
 *
 * Executes raw SQL queries from the CLI and outputs results.
 * Supports inline queries and file-based queries.
 *
 * @example
 * ```bash
 * noorm -H sql "SELECT * FROM users LIMIT 10"
 * noorm -H --json sql "SELECT 1"
 * noorm -H sql -f query.sql
 * ```
 */
import { readFile } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';

import { executeRawSql } from '../../core/sql-terminal/executor.js';

import { withContext, outputError, type HeadlessCommand } from './_helpers.js';

export const help = `
# SQL

Execute raw SQL queries from the command line.

## Usage

    noorm sql <query>
    noorm -H sql "SELECT * FROM users"
    noorm -H sql -f <file>

## Options

    -c, --config NAME   Use specific configuration
    -f, --file PATH     Read SQL from a file instead of inline
    --json              Output results as JSON

## Description

Runs a raw SQL query against the active (or specified) database
configuration and outputs the results.

Queries can be passed inline as a positional argument or read
from a file with the -f/--file flag.

## Examples

    noorm -H sql "SELECT 1"
    noorm -H sql "SELECT * FROM users LIMIT 10"
    noorm -H -c prod sql "SELECT count(*) FROM orders"
    noorm -H --json sql "SELECT id, name FROM users"
    noorm -H sql -f reports/monthly.sql

## Exit Codes

    0   Query executed successfully
    1   Query failed or no query provided

## JSON Output

\`\`\`json
{
    "success": true,
    "columns": ["id", "name"],
    "rows": [
        { "id": 1, "name": "Alice" },
        { "id": 2, "name": "Bob" }
    ],
    "rowsAffected": null,
    "durationMs": 12.5
}
\`\`\`

See \`noorm help db\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    // Determine query source: inline query or file
    let query = params.query ?? params.name;

    if (flags['file'] && typeof flags['file'] === 'string') {

        const [content, readErr] = await attempt(() => readFile(flags['file'] as string, 'utf-8'));

        if (readErr) {

            return outputError(flags, logger, `Failed to read SQL file: ${flags['file']}: ${readErr.message}`);

        }

        query = content.trim();

    }

    if (!query) {

        return outputError(flags, logger, 'No query provided. Usage: noorm -H sql "SELECT ..."');

    }

    const [result, error] = await withContext({
        flags,
        logger,
        fn: async (ctx) => {

            return executeRawSql(ctx.kysely, query, flags.config ?? 'default');

        },
    });

    if (error) return 1;

    if (!result.success) {

        return outputError(flags, logger, `Query failed: ${result.errorMessage}`);

    }

    // Output results
    if (flags.json) {

        logger.info('', result);

    }
    else {

        const rowCount = result.rows?.length ?? 0;
        const affected = result.rowsAffected;

        if (result.rows && result.rows.length > 0) {

            // Log column headers and rows as table
            logger.info(`Columns: ${result.columns?.join(', ')}`);

            for (const row of result.rows) {

                logger.info(JSON.stringify(row));

            }

        }

        if (affected !== undefined) {

            logger.info(`Rows affected: ${affected}`);

        }
        else {

            logger.info(`${rowCount} row${rowCount !== 1 ? 's' : ''} returned (${Math.round(result.durationMs)}ms)`);

        }

    }

    return 0;

};
