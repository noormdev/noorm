import { type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';

export const help = `
# CONFIG RM

Remove a configuration

## Usage

    noorm config rm NAME

## Arguments

    NAME    Name of the configuration to remove

## Description

Permanently deletes the named configuration and its secrets.
Locked stage configs cannot be deleted.

> TUI only - not available in headless mode.

See \`noorm help config\`.
`;

export const run: HeadlessCommand = async (_params, flags, _logger) => {

    const output = flags.json ? help : formatHelp(help);
    process.stdout.write(output + '\\n');

    return 0;

};
