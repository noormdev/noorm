import { createHelpOnlyCommand } from './_helpers.js';

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

export const run = createHelpOnlyCommand(help);
