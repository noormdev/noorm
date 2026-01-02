import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# LOCK STATUS

Check current lock status

## Usage

    noorm lock status
    noorm -H lock status

## Description

Shows whether the database is currently locked and by whom.
Use this to check before running migrations in a shared environment.

## Examples

    noorm -H lock status

## JSON Output

When locked:

\`\`\`json
{
    "isLocked": true,
    "lock": {
        "lockedBy": "deploy@ci-runner",
        "lockedAt": "2024-01-15T10:30:00Z",
        "expiresAt": "2024-01-15T10:35:00Z"
    }
}
\`\`\`

When not locked:

\`\`\`json
{
    "isLocked": false
}
\`\`\`

See \`noorm help lock\` or \`noorm help lock acquire\`.
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [status, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.getLockStatus(),
    });

    if (error) return 1;

    if (flags.json) {

        // Output structured JSON
        const output = status.isLocked && status.lock
            ? {
                isLocked: true,
                lock: {
                    lockedBy: status.lock.lockedBy,
                    lockedAt: status.lock.lockedAt.toISOString(),
                    expiresAt: status.lock.expiresAt.toISOString(),
                },
            }
            : { isLocked: false, lock: null };
        process.stdout.write(JSON.stringify(output) + '\n');

    }
    else if (status.isLocked && status.lock) {

        logger.info(`Locked by ${status.lock.lockedBy}`, {
            since: status.lock.lockedAt.toISOString(),
            expires: status.lock.expiresAt.toISOString(),
        });

    }
    else {

        logger.info('No active lock');

    }

    return 0;

};
