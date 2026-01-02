import { type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';

export const help = `
# CONFIG

Manage database configurations

## Usage

    noorm config [subcommand] [options]

## Subcommands

    add             Create a new configuration
    edit NAME       Edit an existing configuration
    rm NAME         Remove a configuration
    use NAME        Set the active configuration
    validate        Validate configuration settings

## Description

Configurations store database connection details, paths, and settings.
Each config has a name and can be set as **active** for default use.

> Configs are stored encrypted in \`.noorm/state.enc\`

Config resolution order:
1. \`--config\` flag
2. \`NOORM_CONFIG\` env var
3. Active config from state

## Examples

    noorm config                        List all configurations (TUI)
    noorm -H config use dev             Set 'dev' as active config
    noorm -H --config prod change ff    Use 'prod' for this command

## Environment Variables

    NOORM_CONFIG                  Default config name
    NOORM_CONNECTION_HOST         Override connection host
    NOORM_CONNECTION_PORT         Override connection port
    NOORM_CONNECTION_DATABASE     Override database name
    NOORM_CONNECTION_USER         Override username
    NOORM_CONNECTION_PASSWORD     Override password
    NOORM_CONNECTION_DIALECT      Override dialect (postgres|mysql|sqlite|mssql)

> Environment variables override config file values

See \`noorm help config use\` for setting the active config.
`;

export const run: HeadlessCommand = async (_params, flags, _logger) => {

    const output = flags.json ? help : formatHelp(help);

    process.stdout.write(output + '\n');

    return 0;

};
