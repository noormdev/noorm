import { type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';

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

## Description

Database commands for exploration and management. Use explore to
understand your schema, truncate for test resets, and teardown
for complete cleanup.

> **WARNING:** truncate and teardown are destructive operations.
> Protected configs require \`--force\` or confirmation.

## Examples

    noorm -H db explore
    noorm -H db explore tables
    noorm -H db explore tables detail users
    noorm -H db truncate
    noorm -H db teardown

See \`noorm help db explore\`, \`noorm help db truncate\`, or \`noorm help db teardown\`.
`;

export const run: HeadlessCommand = async (_params, flags, _logger) => {

    const output = flags.json ? help : formatHelp(help);
    process.stdout.write(output + '\\n');

    return 0;

};
