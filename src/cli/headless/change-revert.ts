import { withContext, type HeadlessCommand } from './_helpers.js';

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

See \`noorm help change\` or \`noorm help change run\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (!params.name) {

        logger.error('Change name required. Use --name <change>');

        return 1;

    }

    const [result, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.revertChange(params.name!),
    });

    if (error) return 1;

    logger.info(`${result.name} reverted (${result.status})`);

    return result.status === 'success' ? 0 : 1;

};
