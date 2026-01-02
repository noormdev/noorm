import { type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';

export const help = `
# LOCK

Distributed lock management

## Usage

    noorm lock [subcommand] [options]

## Subcommands

    status      Check current lock status
    acquire     Acquire the database lock
    release     Release the current lock
    force       Force release (override ownership)

## Description

Distributed locking prevents concurrent migrations in multi-instance
deployments. Use locks to coordinate CI/CD pipelines.

Locks are stored in the database and include:
- Lock holder identity
- Acquisition timestamp
- Expiration time

## Examples

    noorm -H lock status
    noorm -H lock acquire
    noorm -H lock release

CI/CD with lock protection:

    noorm -H lock acquire
    trap "noorm -H lock release" EXIT
    noorm -H change ff

## JSON Output

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

See \`noorm help lock status\` or \`noorm help lock acquire\`.
`;

export const run: HeadlessCommand = async (_params, flags, _logger) => {

    const output = flags.json ? help : formatHelp(help);
    process.stdout.write(output + '\\n');

    return 0;

};
