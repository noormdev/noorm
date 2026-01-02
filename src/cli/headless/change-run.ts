import { withContext, type HeadlessCommand } from './_helpers.js';

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

See \`noorm help change\`, \`noorm help change ff\`, or \`noorm help change revert\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (!params.name) {

        logger.error('Change name required. Use --name <change>');

        return 1;

    }

    const [result, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.applyChange(params.name!),
    });

    if (error) return 1;

    logger.info(`${result.name} (${result.status})`);

    return result.status === 'success' ? 0 : 1;

};
