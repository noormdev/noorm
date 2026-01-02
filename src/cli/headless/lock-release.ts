import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# LOCK RELEASE

Release the current lock

## Usage

    noorm lock release
    noorm -H lock release

## Description

Releases the current database lock. Only the lock holder can release.
Use \`lock force\` to override ownership.

## Examples

    noorm -H lock release

## Exit Codes

    0   Lock released successfully
    1   No lock to release or not owner

See \`noorm help lock\` or \`noorm help lock acquire\`.
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [, error] = await withContext({
        flags,
        logger,
        fn: async (ctx) => {

            await ctx.releaseLock();

            return true;

        },
    });

    if (error) return 1;

    logger.info('Lock released');

    return 0;

};
