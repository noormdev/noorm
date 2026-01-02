import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# DB TRUNCATE

Wipe all data, keep schema

## Usage

    noorm db truncate
    noorm -H db truncate

## Description

Truncates all tables in the database, removing all data while
keeping the schema intact. Useful for resetting test databases.

> **WARNING:** This is a destructive operation. Protected configs
> require \`--force\` or confirmation.

## Examples

    noorm -H db truncate
    noorm -H -y db truncate

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
        fn: (ctx) => ctx.truncate(),
    });

    if (error) return 1;

    if (flags.json) {

        // Output structured JSON
        const output = {
            truncated: result.truncated,
            count: result.truncated.length,
        };
        process.stdout.write(JSON.stringify(output) + '\n');

    }
    else {

        logger.info(`Truncated ${result.truncated.length} tables`, {
            tables: result.truncated,
        });

    }

    return 0;

};
