import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# DB EXPLORE TABLES DETAIL

Describe a specific table

## Usage

    noorm db explore tables detail NAME
    noorm -H db explore tables detail NAME
    noorm -H --name NAME db explore tables detail

## Arguments

    NAME    Name of the table to describe

## Description

Shows detailed schema information for a table including columns,
data types, nullability, and primary key status.

## Examples

    noorm -H db explore tables detail users
    noorm -H --json db explore tables detail posts

## JSON Output

\`\`\`json
{
    "name": "users",
    "schema": "public",
    "columns": [
        { "name": "id", "dataType": "integer", "nullable": false, "isPrimaryKey": true },
        { "name": "email", "dataType": "varchar(255)", "nullable": false },
        { "name": "created_at", "dataType": "timestamp", "nullable": false }
    ]
}
\`\`\`

See \`noorm help db explore tables\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (!params.name) {

        logger.error('Table name required. Use --name <table>');

        return 1;

    }

    const [detail, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.describeTable(params.name!, params.schema),
    });

    if (error) return 1;

    if (!detail) {

        logger.error(`Table not found: ${params.name}`);

        return 1;

    }

    logger.info(`Table: ${detail.name}`, {
        columns: detail.columns.map((c) => `${c.name}: ${c.dataType}`),
    });

    return 0;

};
