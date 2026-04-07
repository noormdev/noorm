import { createHelpOnlyCommand } from './_helpers.js';

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

> Interactive only — launches the TUI wizard. For headless configuration,
> use \`NOORM_*\` environment variables to override settings at runtime
> (e.g., \`NOORM_CONNECTION_HOST\`, \`NOORM_CONNECTION_DIALECT\`).

## Examples

    noorm settings

See \`noorm help config\`.
`;

export const run = createHelpOnlyCommand(help);
