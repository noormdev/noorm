/**
 * noorm mcp serve — start the noorm MCP server on stdio.
 *
 * This is a long-running command. The MCP SDK holds the event loop open
 * via stdin; do not call process.exit() here.
 */
import { defineCommand } from 'citty';

import { startServer } from '../../mcp/index.js';

const serveCommand = defineCommand({
    meta: {
        name: 'serve',
        description: 'Start the noorm MCP server on stdio transport',
    },
    async run() {

        await startServer();
        // Intentionally no process.exit — stdin keeps the loop alive.

    },
});

(serveCommand as typeof serveCommand & { examples: string[] }).examples = [
    'noorm mcp serve',
];

export default serveCommand;
