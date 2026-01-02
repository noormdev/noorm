import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# RUN BUILD

Execute all SQL files in schema directory

## Usage

    noorm run build [options]
    noorm -H run build

## Options

    -f, --force     Force execution (skip checksum validation)
    --dry-run       Preview without executing

## Description

Executes all SQL files in the \`sql/\` directory in alphabetical order.
Tracks checksums to skip unchanged files on subsequent runs.

Use \`--force\` to rebuild everything regardless of checksums.

## Examples

    noorm -H run build
    noorm -H --force run build
    noorm -H --dry-run run build

## JSON Output

\`\`\`json
{
    "status": "success",
    "filesRun": 5,
    "filesSkipped": 2,
    "filesFailed": 0,
    "durationMs": 1234
}
\`\`\`

See \`noorm help run\` or \`noorm help run file\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    const [result, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.build({ force: params.force ?? flags.force }),
    });

    if (error) return 1;

    logger.info('Build completed successfully', {
        status: result.status,
        filesRun: result.filesRun,
        filesSkipped: result.filesSkipped,
        filesFailed: result.filesFailed,
        durationMs: result.durationMs,
    });

    return result.status === 'success' ? 0 : 2;

};
