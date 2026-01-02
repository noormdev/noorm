import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# RUN FILE

Execute a single SQL file

## Usage

    noorm run file PATH
    noorm -H run file PATH

## Arguments

    PATH    Path to the SQL file to execute

## Description

Executes a single SQL file against the database.
Supports \`.sql\` and \`.sql.eta\` (templated) files.

## Examples

    noorm -H run file seed.sql
    noorm -H run file migrations/001_init.sql

## JSON Output

\`\`\`json
{
    "filepath": "seed.sql",
    "status": "success",
    "durationMs": 45
}
\`\`\`

See \`noorm help run\` or \`noorm help run dir\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (!params.path) {

        logger.error('File path required. Use --path <file.sql>');

        return 1;

    }

    const [result, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.runFile(params.path!),
    });

    if (error) return 1;

    const isSkipped = result.status === 'skipped';

    logger.info(`${result.filepath} (${result.status})`);

    return result.status === 'success' || isSkipped ? 0 : 1;

};
