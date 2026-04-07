import { withContext, outputError, type HeadlessCommand } from './_helpers.js';

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
Supports \`.sql\` and \`.sql.tmpl\` (templated) files.

## Examples

    noorm -H run file seed.sql
    noorm -H run file migrations/001_init.sql
    noorm -H --json run file sql/init.sql.tmpl

## JSON Output

\`\`\`json
{
    "filepath": "seed.sql",
    "status": "success",
    "durationMs": 45
}
\`\`\`

Status is \`"success"\` or \`"skipped"\` (unchanged checksum).

See \`noorm help run\` or \`noorm help run dir\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (!params.path) {

        return outputError(flags, logger, 'File path required. Use --path <file.sql>');

    }

    const [result, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.noorm.run.file(params.path!),
    });

    if (error) return 1;

    const isSkipped = result.status === 'skipped';

    logger.info(`${result.filepath} (${result.status})`);

    return result.status === 'success' || isSkipped ? 0 : 1;

};
