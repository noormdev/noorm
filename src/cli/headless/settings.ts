import { type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';

export const help = `
# SETTINGS

View/edit project settings

## Usage

    noorm settings

## Description

Opens the settings screen to view and modify project configuration.
Settings are stored in \`.noorm/settings.yml\`.

Settings include:
- Stage definitions (dev, staging, production)
- Build rules and paths
- Logging configuration
- Identity defaults

> TUI only - not available in headless mode.

See \`noorm help config\`.
`;

export const run: HeadlessCommand = async (_params, flags, _logger) => {

    const output = flags.json ? help : formatHelp(help);
    process.stdout.write(output + '\\n');

    return 0;

};
