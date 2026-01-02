import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# DB EXPLORE TABLES

List all tables

## Usage

    noorm db explore tables
    noorm -H db explore tables

## Description

Lists all tables in the database with their column counts.

## Examples

    noorm -H db explore tables
    noorm -H --json db explore tables

## JSON Output

\`\`\`json
[
    { "name": "users", "columnCount": 8 },
    { "name": "posts", "columnCount": 5 },
    { "name": "comments", "columnCount": 4 }
]
\`\`\`

See \`noorm help db explore\` or \`noorm help db explore tables detail\`.
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [tables, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.listTables(),
    });

    if (error) return 1;

    logger.info(`Tables: ${tables.length}`, {
        tables: tables.map((t) => `${t.name} (${t.columnCount} cols)`),
    });

    return 0;

};
