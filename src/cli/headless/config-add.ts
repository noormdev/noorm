import { type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';

export const help = `
# CONFIG ADD

Create a new configuration

## Usage

    noorm config add

## Description

Opens an interactive wizard to create a new database configuration.
Guides you through connection details, paths, and settings.

> TUI only - not available in headless mode.

See \`noorm help config\` or \`noorm help config edit\`.
`;

export const run: HeadlessCommand = async (_params, flags, _logger) => {

    const output = flags.json ? help : formatHelp(help);
    process.stdout.write(output + '\\n');

    return 0;

};
