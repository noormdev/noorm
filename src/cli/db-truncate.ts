import { withContext, outputResult, type HeadlessCommand } from './_helpers.js';

export const help = `
# DB TRUNCATE

Wipe all data, keep schema

## Usage

    noorm -H db truncate [options]

## Flags

    -y, --yes      Skip confirmation prompt
    -f, --force    Override protection on protected configs

## Description

Truncates all tables in the database, removing all data while
keeping the schema intact. Tables are truncated in foreign key
dependency order. Useful for resetting test databases between runs.

> **WARNING:** This is a destructive operation. Protected configs
> require \`--force\` or confirmation.

## Examples

    # Truncate with confirmation skip
    noorm -H -y db truncate

    # Force truncate on protected config
    noorm -H --force db truncate

    # JSON output for scripting
    noorm -H --json -y db truncate

## JSON Output

\`\`\`json
{
    "truncated": ["users", "posts", "comments"],
    "count": 3
}
\`\`\`

See \`noorm help db\` or \`noorm help db teardown\`.
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [result, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.noorm.db.truncate(),
    });

    if (error) return 1;

    outputResult(flags, logger, {
        truncated: result.truncated,
        count: result.truncated.length,
    }, `Truncated ${result.truncated.length} tables`, {
        tables: result.truncated,
    });

    return 0;

};
