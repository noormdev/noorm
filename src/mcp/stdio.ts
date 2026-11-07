import { type McpServer, type Transport, type JSONRPCMessage } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const metadataSchema = z.object({
    'io.modelcontextprotocol/protocolVersion': z.string(),
    'io.modelcontextprotocol/clientCapabilities': z.record(z.string(), z.unknown()),
});

/** Validate every request, including later requests on an already-selected SDK era. */
export function serveModernMcp(server: McpServer, transport: Transport = new StdioServerTransport()) {

    const guarded: Transport = {
        async start() {

            transport.onmessage = (message: JSONRPCMessage) => {

                if ('method' in message && 'id' in message) {

                    const params = z.object({ _meta: metadataSchema }).safeParse(message.params);
                    const version = params.success ? params.data._meta['io.modelcontextprotocol/protocolVersion'] : undefined;
                    if (!params.success || version !== '2026-07-28') {

                        const error = !params.success
                            ? { code: -32602, message: 'MCP 2026-07-28 requires protocolVersion and clientCapabilities in _meta on every request' }
                            : { code: -32022, message: 'Unsupported protocol version', data: { requested: version, supported: ['2026-07-28'] } };
                        void transport.send({ jsonrpc: '2.0', id: message.id, error }).catch((failure: unknown) => {

                            guarded.onerror?.(failure instanceof Error ? failure : new Error(String(failure)));

                        });

                        return;

                    }

                }

                guarded.onmessage?.(message);

            };
            transport.onclose = () => guarded.onclose?.();
            transport.onerror = (error) => guarded.onerror?.(error);
            await transport.start();

        },
        async send(message, options) {

            await transport.send(message, options);

        },
        async close() {

            await transport.close();

        },
    };

    return serveStdio(() => server, {
        transport: guarded,
        legacy: 'reject',
        onerror: (error) => console.error(error.message),
    });

}
