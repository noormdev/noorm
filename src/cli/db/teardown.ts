import { withContext, outputResult, type HeadlessCommand } from './_helpers.js';

export const help = `
# DB TEARDOWN

Drop all database objects

## Usage

    noorm -H db teardown [options]

## Flags

    -y, --yes      Skip confirmation prompt
    -f, --force    Override protection on protected configs

## Description

Drops all database objects including tables, views, functions,
and types. Objects are dropped in dependency order to avoid
foreign key violations. Keeps noorm tracking tables so the project
can be rebuilt from scratch.

> **WARNING:** This is a destructive operation. Protected configs
> require \`--force\` or confirmation.

## Examples

    # Teardown with confirmation skip
    noorm -H -y db teardown

    # Force teardown on protected config
    noorm -H --force db teardown

    # JSON output for scripting
    noorm -H --json -y db teardown

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
        fn: (ctx) => ctx.noorm.db.teardown(),
    });

    if (error) return 1;

    const droppedCount = result.dropped.tables.length +
        result.dropped.views.length +
        result.dropped.functions.length +
        result.dropped.types.length;

    outputResult(flags, logger, {
        dropped: result.dropped,
        count: droppedCount,
    }, `Dropped ${droppedCount} objects`, {
        tables: result.dropped.tables.length,
        views: result.dropped.views.length,
        functions: result.dropped.functions.length,
        types: result.dropped.types.length,
    });

    return 0;

};
