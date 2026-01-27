/**
 * Vault headless command - help text.
 *
 * Shows vault command help.
 */
import { type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';

export const help = `
# VAULT

Manage vault secrets (team-shared)

## Usage

    noorm vault <subcommand>

## Subcommands

    init        Initialize the vault
    set         Set a vault secret
    list        List vault secrets
    rm          Remove a vault secret
    cp          Copy secrets between configs
    propagate   Propagate vault access to new users

## Description

Vault secrets are encrypted secrets shared across the team via the database.
They provide a fallback when local secrets are not set.

**Secret resolution order:**
1. Config-specific local secrets (highest priority)
2. Global local secrets
3. Vault secrets (team-shared, lowest priority)

Local always wins over vault.

## Examples

    noorm vault init                          Initialize vault
    noorm vault set API_KEY "sk-live-..."     Set a secret
    noorm vault list                          List all secrets
    noorm vault rm OLD_KEY                    Remove a secret
    noorm vault cp API_KEY staging prod       Copy secret between configs
    noorm vault cp --all staging prod         Copy all secrets
    noorm vault propagate                     Grant vault access to new users

See \`noorm help vault init\`, \`noorm help vault set\`, etc.
`;

export const run: HeadlessCommand = async (_params, flags, _logger) => {

    const output = flags.json ? help : formatHelp(help);
    process.stdout.write(output + '\n');

    return 0;

};
