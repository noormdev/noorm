import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# CHANGE

Manage and apply changesets

## Usage

    noorm change [subcommand] [options]

## Subcommands

    (none)      List all changesets and their status
    ff          Fast-forward: apply all pending changesets
    run NAME    Apply a specific changeset
    revert NAME Revert a specific changeset
    history     Show execution history

## Description

Changesets are versioned SQL migrations stored in the \`changesets/\`
directory. Each changeset has forward (apply) and backward (revert)
SQL files.

Changeset status:
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

    const [changesets, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.getChangesetStatus(),
    });

    if (error) return 1;

    for (const cs of changesets) {

        logger.info(`${cs.name} (${cs.status})`);

    }

    const pending = changesets.filter((c) => c.status === 'pending').length;

    if (pending > 0) {

        logger.info(`${pending} pending changeset(s)`);

    }

    return 0;

};
