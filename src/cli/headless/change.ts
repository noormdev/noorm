import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# CHANGE

Manage and apply changes

## Usage

    noorm change [subcommand] [options]

## Subcommands

    (none)      List all changes and their status
    ff          Fast-forward: apply all pending changes
    run NAME    Apply a specific change
    revert NAME Revert a specific change
    history     Show execution history

## Description

Changes are versioned SQL migrations stored in the \`changes/\`
directory. Each change has forward (apply) and backward (revert)
SQL files.

Change status:
- **pending** - Not yet applied
- **applied** - Successfully applied
- **failed** - Execution failed

## Examples

    noorm -H change
    noorm -H change ff
    noorm -H change run 001_users
    noorm -H change revert 001_users

## JSON Output

\`\`\`json
[
    { "name": "001_users", "status": "applied" },
    { "name": "002_posts", "status": "pending" }
]
\`\`\`

See \`noorm help change ff\`, \`noorm help change run\`, or \`noorm help change history\`.
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [changes, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.getChangeStatus(),
    });

    if (error) return 1;

    for (const cs of changes) {

        logger.info(`${cs.name} (${cs.status})`);

    }

    const pending = changes.filter((c) => c.status === 'pending').length;

    if (pending > 0) {

        logger.info(`${pending} pending change(s)`);

    }

    return 0;

};
