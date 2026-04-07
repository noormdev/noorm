import { withContext, outputError, type HeadlessCommand } from './_helpers.js';

export const help = `
# CHANGE REVERT

Revert a specific change

## Usage

    noorm change revert NAME
    noorm -H change revert NAME

## Arguments

    NAME    Name of the change to revert

## Description

Reverts a single applied change by running its backward SQL.
The change must have been previously applied.

## Examples

    noorm -H change revert 002_users
    noorm -H change revert 001_init
    noorm -H --json change revert 002_users

## JSON Output

\`\`\`json
{
    "name": "002_users",
    "direction": "revert",
    "status": "success",
    "files": [
        { "filepath": "revert/001_drop-table.sql", "checksum": "d4e5f6", "status": "executed", "durationMs": 12 }
    ],
    "durationMs": 30
}
\`\`\`

See \`noorm help change\` or \`noorm help change run\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (!params.name) {

        return outputError(flags, logger, 'Change name required. Use --name <change>');

    }

    const [result, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.noorm.changes.revert(params.name!),
    });

    if (error) return 1;

    logger.info(`${result.name} reverted (${result.status})`);

    return result.status === 'success' ? 0 : 2;

};
