import { createHelpOnlyCommand } from './_helpers.js';

export const help = `
# CONFIG RM

Remove a configuration

## Usage

    noorm config rm NAME

## Arguments

    NAME    Name of the configuration to remove

## Description

Permanently deletes the named configuration and its secrets.
Cannot delete the active configuration. Protected configs
require typed confirmation before deletion.

> Interactive only — launches the TUI wizard.

## Examples

    noorm config rm staging
    noorm config rm old-dev

See \`noorm help config\`.
`;

export const run = createHelpOnlyCommand(help);
