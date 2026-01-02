import { type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';

export const help = `
# IDENTITY

Manage identity

## Usage

    noorm identity

## Description

Opens the identity management screen. Identity is used for:
- Lock ownership
- Audit logging
- Changeset attribution

Identity can be derived from:
- Git config (\`user.name\`, \`user.email\`)
- Environment variables
- Manual configuration

> TUI only - not available in headless mode.

See \`noorm help lock\`.
`;

export const run: HeadlessCommand = async (_params, flags, _logger) => {

    const output = flags.json ? help : formatHelp(help);
    process.stdout.write(output + '\\n');

    return 0;

};
