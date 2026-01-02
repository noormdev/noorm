import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# LOCK ACQUIRE

Acquire the database lock

## Usage

    noorm lock acquire
    noorm -H lock acquire

## Description

Acquires an exclusive lock on the database. Fails if already locked.
Use this to prevent concurrent migrations in multi-instance deployments.

> Locks expire automatically after a timeout period.

## Examples

    noorm -H lock acquire

CI/CD pattern with cleanup:

    noorm -H lock acquire
    trap "noorm -H lock release" EXIT
    noorm -H change ff

## Exit Codes

    0   Lock acquired successfully
    1   Lock acquisition failed (already locked)

See \`noorm help lock\` or \`noorm help lock release\`.
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [lock, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.acquireLock(),
    });

    if (error) return 1;

    logger.info('Lock acquired', {
        lockedBy: lock.lockedBy,
        expiresAt: lock.expiresAt.toISOString(),
    });

    return 0;

};
