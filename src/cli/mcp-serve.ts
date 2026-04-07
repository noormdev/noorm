import { startServer } from '../../mcp/index.js';
import type { HeadlessCommand } from './_helpers.js';

export const help = `
# MCP SERVE

Start the noorm MCP server on stdio transport.

## Usage

    noorm mcp serve

## Description

Starts a long-running MCP server that communicates via stdin/stdout
using the JSON-RPC protocol. Coding agents spawn this process
automatically when configured via \`.mcp.json\`.

This command is typically not run directly — use \`noorm mcp init\`
to generate the configuration, then your coding agent handles the rest.

## Notes

- stdout is reserved for MCP protocol — diagnostics go to stderr
- The server stays alive until the agent disconnects or the process is killed
- All database configurations are accessible via the \`config\` parameter
`;

export const run: HeadlessCommand = async () => {

    // This handler is a fallback — main() short-circuits mcp/serve
    // before runHeadless() is called. If we get here, start anyway.
    await startServer();

    return 0;

};
