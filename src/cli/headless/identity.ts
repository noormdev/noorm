import { createHelpOnlyCommand } from './_helpers.js';

export const help = `
# IDENTITY

Manage identity

## Usage

    noorm identity

## Description

Opens the identity management screen. Identity is used for:
- Lock ownership
- Audit logging
- Change attribution

Identity can be derived from:
- Git config (\`user.name\`, \`user.email\`)
- Environment variables
- Manual configuration

> Interactive only — launches the TUI wizard. In CI/CD, identity is
> derived automatically from git config or environment variables.

## Examples

    noorm identity

See \`noorm help lock\`.
`;

export const run = createHelpOnlyCommand(help);
