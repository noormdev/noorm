import { withContext, outputError, type HeadlessCommand } from './_helpers.js';

export const help = `
# CHANGE RUN

Apply a specific change

## Usage

    noorm change run NAME
    noorm -H change run NAME

## Arguments

    NAME    Name of the change to apply

## Description

Applies a single change by name. Use this to apply changes
out of order or to retry a failed change.

## Examples

    noorm -H change run 001_init
    noorm -H change run 002_users
    noorm -H --json change run 2024-02-01-notifications

## JSON Output

\`\`\`json
{
    "name": "001_init",
    "direction": "change",
    "status": "success",
    "files": [
        { "filepath": "change/001_create-table.sql", "checksum": "a1b2c3", "status": "executed", "durationMs": 23 }
    ],
    "durationMs": 45
}
\`\`\`

See \`noorm help change\`, \`noorm help change ff\`, or \`noorm help change revert\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (!params.name) {

        return outputError(flags, logger, 'Change name required. Use --name <change>');

    }

    const [result, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.noorm.changes.apply(params.name!),
    });

    if (error) return 1;

    logger.info(`${result.name} (${result.status})`);

    return result.status === 'success' ? 0 : 2;

};
