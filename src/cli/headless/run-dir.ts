import { withContext, outputError, type HeadlessCommand } from './_helpers.js';

export const help = `
# RUN DIR

Execute all SQL files in a directory

## Usage

    noorm run dir PATH
    noorm -H run dir PATH

## Arguments

    PATH    Path to the directory containing SQL files

## Description

Executes all SQL files in the specified directory in alphabetical order.
Supports \`.sql\` and \`.sql.tmpl\` (templated) files.

## Examples

    noorm -H run dir migrations/
    noorm -H run dir seeds/
    noorm -H --json run dir sql/01_tables/

## JSON Output

\`\`\`json
{
    "status": "success",
    "filesRun": 3,
    "filesSkipped": 1,
    "filesFailed": 0
}
\`\`\`

See \`noorm help run\` or \`noorm help run file\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (!params.path) {

        return outputError(flags, logger, 'Directory path required. Use --path <dir>');

    }

    const [result, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.noorm.run.dir(params.path!),
    });

    if (error) return 1;

    logger.info(`Run directory ${result.status}`, {
        filesRun: result.filesRun,
        filesSkipped: result.filesSkipped,
        filesFailed: result.filesFailed,
    });

    return result.status === 'success' ? 0 : 2;

};
