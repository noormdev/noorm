import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# DB EXPLORE

Explore database schema

## Usage

    noorm db explore [subcommand] [options]

## Subcommands

    (none)          Get database overview with object counts
    tables          List all tables
    tables detail   Describe a specific table

## Description

Explore your database schema to understand its structure.
Useful for debugging, documentation, and development.

## Examples

    noorm -H db explore
    noorm -H db explore tables
    noorm -H db explore tables detail users
    noorm -H --json db explore > schema.json

## JSON Output

Overview:

\`\`\`json
{
    "tables": 12,
    "views": 3,
    "functions": 5,
    "procedures": 0,
    "types": 2
}
\`\`\`

Tables list:

\`\`\`json
[
    { "name": "users", "columnCount": 8 },
    { "name": "posts", "columnCount": 5 }
]
\`\`\`

See \`noorm help db explore tables detail\`.
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [overview, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.overview(),
    });

    if (error) return 1;

    logger.info('Database Overview', overview);

    return 0;

};
