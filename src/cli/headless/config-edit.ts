import { createHelpOnlyCommand } from './_helpers.js';

export const help = `
# CONFIG EDIT

Edit an existing configuration

## Usage

    noorm config edit NAME

## Arguments

    NAME    Name of the configuration to edit

## Description

Opens the configuration editor for the named config.
Allows modifying connection details, paths, and settings.
Dialect cannot be changed — recreate the config instead.

> Interactive only — launches the TUI wizard.

## Examples

    noorm config edit dev
    noorm config edit production

See \`noorm help config\` or \`noorm help config add\`.
`;

export const run = createHelpOnlyCommand(help);
