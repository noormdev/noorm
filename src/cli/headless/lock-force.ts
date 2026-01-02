import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# LOCK FORCE

Force release any database lock

## Usage

    noorm lock force
    noorm -H lock force

## Description

Force releases the database lock regardless of ownership.
Use this when a lock holder crashed or when emergency intervention is needed.

> Warning: Force releasing a lock can cause data corruption if the original
> holder is still running operations.

## Examples

    noorm -H lock force

## Exit Codes

    0   Lock force-released successfully
    1   No lock to release or operation failed

See \`noorm help lock\` or \`noorm help lock acquire\`.
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [, error] = await withContext({
        flags,
        logger,
        fn: async (ctx) => {

            await ctx.forceReleaseLock();

            return true;

        },
    });

    if (error) return 1;

    logger.info('Lock force-released');

    return 0;

};
