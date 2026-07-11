import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createRegistry, SessionManager } from '../rpc/index.js';
import { createMcpServer } from './server.js';

/**
 * Start the MCP server on stdio transport.
 *
 * This function never returns — the stdio event loop keeps the process alive.
 * Stdout is reserved for JSON-RPC. Diagnostics go to stderr.
 */
export async function startServer(): Promise<void> {

    const registry = createRegistry();
    const session = new SessionManager('mcp');
    const server = createMcpServer(registry, session);
    const transport = new StdioServerTransport();

    process.on('SIGINT', () => session.disconnectAll());
    process.on('SIGTERM', () => session.disconnectAll());

    await server.connect(transport);

    console.error('noorm MCP server running on stdio');

}
