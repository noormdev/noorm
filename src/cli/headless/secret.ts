import { type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';

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

> TUI only - not available in headless mode.

See \`noorm help config\`.
`;

export const run: HeadlessCommand = async (_params, flags, _logger) => {

    const output = flags.json ? help : formatHelp(help);
    process.stdout.write(output + '\\n');

    return 0;

};
