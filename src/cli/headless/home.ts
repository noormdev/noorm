import { createHelpOnlyCommand } from './_helpers.js';

export const help = `
# NOORM

Database Schema & Change Manager

## Usage

    noorm [command] [subcommand] [options]

## Commands

    config      Manage database configurations
    change      Manage and apply changes
    run         Execute SQL files
    sql         Execute raw SQL queries
    db          Database operations and exploration
    lock        Distributed lock management
    settings    View/edit project settings
    secret      Manage secrets
    identity    Manage identity

## Options

    -H, --headless      Force headless mode (no TUI)
    -T, --tui           Force TUI mode
    --json              Output JSON (headless only)
    -c, --config NAME   Use specific configuration
    -f, --force         Force operation
    -y, --yes           Skip confirmations
    --dry-run           Preview without executing

## Examples

    noorm
    noorm config
    noorm -H run build
    noorm -H --json change ff

Run \`noorm help <command>\` for detailed help on a command.
`;

export const run = createHelpOnlyCommand(help);
