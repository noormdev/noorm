import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# CHANGE REVERT

Revert a specific changeset

## Usage

    noorm change revert NAME
    noorm -H change revert NAME

## Arguments

    NAME    Name of the changeset to revert

## Description

Reverts a single applied changeset by running its backward SQL.
The changeset must have been previously applied.

## Examples

    noorm -H change revert 002_users
    noorm -H change revert 001_init

See \`noorm help change\` or \`noorm help change run\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (!params.name) {

        logger.error('Changeset name required. Use --name <changeset>');

        return 1;

    }

    const [result, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.revertChangeset(params.name!),
    });

    if (error) return 1;

    logger.info(`${result.name} reverted (${result.status})`);

    return result.status === 'success' ? 0 : 1;

};
