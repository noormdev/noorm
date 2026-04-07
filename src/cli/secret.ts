import { createHelpOnlyCommand } from './_helpers.js';

export const help = `
# SECRET

Manage secrets

## Usage

    noorm secret

## Description

Opens the secrets management screen. Secrets are encrypted values
stored per-config, used for sensitive connection parameters.

Common secrets:
- \`DATABASE_PASSWORD\`
- \`SSL_CERTIFICATE\`
- \`API_KEY\`

> Secrets are stored encrypted in \`.noorm/state/state.enc\`.

> Interactive only — launches the TUI wizard. For headless secret
> management, use the \`noorm -H vault\` commands.

## Examples

    noorm secret

See \`noorm help config\`, \`noorm help vault\`.
`;

export const run = createHelpOnlyCommand(help);
