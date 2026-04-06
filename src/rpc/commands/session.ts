import { z } from 'zod';

import type { RpcCommand } from '../types.js';

const connectSchema = z.object({
    config: z.string().optional().describe('Config name to connect to. Omit to use active config.'),
});

const disconnectSchema = z.object({
    config: z.string().optional().describe('Config name to disconnect. Omit to disconnect all.'),
});

type ConnectInput = z.infer<typeof connectSchema>;
type DisconnectInput = z.infer<typeof disconnectSchema>;

const connectCommand: RpcCommand<ConnectInput> = {
    name: 'connect',
    description: 'Connect to a database configuration. Must be called before using any database commands.',
    examples: [
        { description: 'connect to active config', input: {} },
        { description: 'connect to specific config', input: { config: 'dev' } },
    ],
    inputSchema: connectSchema,
    handler: async (input, session) => {

        return session.connect(input.config);

    },
};

const disconnectCommand: RpcCommand<DisconnectInput> = {
    name: 'disconnect',
    description: 'Disconnect from a database configuration. Omit config to disconnect all.',
    examples: [
        { description: 'disconnect all', input: {} },
        { description: 'disconnect specific config', input: { config: 'dev' } },
    ],
    inputSchema: disconnectSchema,
    handler: async (input, session) => {

        await session.disconnect(input.config);

        return { disconnected: true };

    },
};

export const sessionCommands: RpcCommand[] = [
    connectCommand as RpcCommand,
    disconnectCommand as RpcCommand,
];
