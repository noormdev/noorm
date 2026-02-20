import { type HeadlessCommand, createHelpOnlyCommand } from './_helpers.js';

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

> TUI only - not available in headless mode.

See \`noorm help config\` or \`noorm help config add\`.
`;

export const run = createHelpOnlyCommand(help);
