import { createHelpOnlyCommand } from './_helpers.js';

export const help = `
# DB

Database operations and exploration

## Usage

    noorm db [subcommand] [options]

## Subcommands

    explore         Get database overview with object counts
    explore tables  List all tables
    explore tables detail NAME
                    Describe a specific table
    truncate        Wipe all data, keep schema
    teardown        Drop all database objects
    transfer        Transfer data between configs or export/import .dt files

## Description

Database commands for exploration and management. Use explore to
understand your schema, truncate for test resets, teardown for
complete cleanup, and transfer for data migration between environments.

> **WARNING:** truncate and teardown are destructive operations.
> Protected configs require \`--force\` or confirmation.

## Examples

    noorm -H db explore
    noorm -H db explore tables
    noorm -H db explore tables detail users
    noorm -H db truncate
    noorm -H db teardown
    noorm -H db transfer --to backup
    noorm -H db transfer --export ./backup/ --compress

## See Also

See \`noorm help db explore\`, \`noorm help db truncate\`, \`noorm help db teardown\`, or \`noorm help db transfer\`.
`;

export const run = createHelpOnlyCommand(help);
