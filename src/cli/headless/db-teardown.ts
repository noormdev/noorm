import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# DB TEARDOWN

Drop all database objects

## Usage

    noorm db teardown
    noorm -H db teardown

## Description

Drops all database objects including tables, views, functions,
and types. Keeps noorm tracking tables.

> **WARNING:** This is a destructive operation. Protected configs
> require \`--force\` or confirmation.

## Examples

    noorm -H db teardown
    noorm -H -y db teardown

## JSON Output

\`\`\`json
{
    "dropped": {
        "tables": 5,
        "views": 2,
        "functions": 3,
        "types": 1
    },
    "count": 11
}
\`\`\`

See \`noorm help db\` or \`noorm help db truncate\`.
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [result, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.teardown(),
    });

    if (error) return 1;

    const droppedCount = result.dropped.tables.length +
        result.dropped.views.length +
        result.dropped.functions.length +
        result.dropped.types.length;

    logger.info(`Dropped ${droppedCount} objects`, {
        tables: result.dropped.tables.length,
        views: result.dropped.views.length,
        functions: result.dropped.functions.length,
        types: result.dropped.types.length,
    });

    return 0;

};
