import { createRegistry } from '../rpc/index.js';
import { createMcpServer } from './server.js';
import { serveModernMcp } from './stdio.js';

/** Serve modern MCP; stdout is reserved for JSON-RPC and diagnostics use stderr. */
export async function startServer(): Promise<void> {

    const server = createMcpServer(createRegistry());
    const handle = serveModernMcp(server);
    const shutdown = () => {

        void handle.close();

    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    console.error('noorm MCP server running on stdio (2026-07-28)');

}
