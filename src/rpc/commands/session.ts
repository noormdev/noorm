import { z } from 'zod';
import { attempt } from '@logosdx/utils';

import { initState } from '../../core/state/index.js';
import { getEnvConfigName } from '../../core/environment.js';
import type { RpcCommand } from '../types.js';
import { RpcError } from '../types.js';

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
    permission: 'open',
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
    permission: 'open',
    handler: async (input, session) => {

        await session.disconnect(input.config);

        return { disconnected: true };

    },
};

/**
 * Snapshot of session connection state returned by the `status` command.
 */
export interface SessionStatus {
    connections: string[];
    activeConfig: string | null;
    activeConnected: boolean;
}

/**
 * Reports what an agent is connected to and what a bare `connect` would
 * target, giving `SessionManager.hasConnection`/`listConnections`
 * (`src/rpc/session.ts:166,175`) their production callers — closing
 * AP-yagni-06 productively (decision D9, tickets/v1/00-DECISIONS.md).
 * Read-only: no session mutation.
 *
 * Active-config resolution mirrors `resolveConfig`'s no-name path
 * (`src/core/config/resolver.ts:214`) so `status` reports exactly what a
 * bare `connect` would target. On the agent channel, a config hidden via
 * `access.agent === false` (or unknown to state) is reported as no active
 * config, same invisibility `list_configs` applies — `status` must not leak
 * a hidden config's name through the active-config field.
 *
 * @example
 * const { connections, activeConfig, activeConnected } = await cmd.handler({}, session);
 */
const statusCommand: RpcCommand<Record<string, never>, SessionStatus> = {
    name: 'status',
    description: 'Show connected configs and the active config. Does not require a database connection.',
    examples: [
        { description: 'check session status', input: {} },
    ],
    inputSchema: z.object({}),
    permission: 'open',
    handler: async (_input, session): Promise<SessionStatus> => {

        const [manager, err] = await attempt(() => initState());

        if (err) {

            throw new RpcError('Failed to load state', err.message);

        }

        const connections = session.listConnections();
        let activeConfig = getEnvConfigName() ?? manager.getActiveConfigName() ?? null;

        if (activeConfig && session.channel === 'agent') {

            const config = manager.getConfig(activeConfig);

            if (!config || config.access.agent === false) {

                activeConfig = null;

            }

        }

        return {
            connections,
            activeConfig,
            activeConnected: activeConfig !== null && session.hasConnection(activeConfig),
        };

    },
};

export const sessionCommands: RpcCommand[] = [
    connectCommand as RpcCommand,
    disconnectCommand as RpcCommand,
    statusCommand as RpcCommand,
];
