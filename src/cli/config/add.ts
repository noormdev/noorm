import { createHelpOnlyCommand } from './_helpers.js';

export const help = `
# CONFIG ADD

Create a new configuration

## Usage

    noorm config add

## Description

Opens an interactive wizard to create a new database configuration.
Guides you through name, dialect, connection details (host, port, database,
user, password), and options (protected, test). Tests the connection before
saving.

> Interactive only — launches the TUI wizard.

## Examples

    noorm config add

See \`noorm help config\` or \`noorm help config edit\`.
`;

export const run = createHelpOnlyCommand(help);
