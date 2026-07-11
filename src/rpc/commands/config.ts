import { z } from 'zod';
import { attempt } from '@logosdx/utils';

import { initState } from '../../core/state/index.js';
import type { ConfigSummary } from '../../core/config/types.js';
import type { RpcCommand } from '../types.js';
import { RpcError } from '../types.js';

const listConfigsCommand: RpcCommand<Record<string, never>, ConfigSummary[]> = {
    name: 'list_configs',
    description: 'List all database configurations with dialect, database name, and access role. Does not require a database connection.',
    examples: [
        { description: 'list all configs', input: {} },
    ],
    inputSchema: z.object({}),
    permission: 'open',
    handler: async (_input, session): Promise<ConfigSummary[]> => {

        const [manager, err] = await attempt(() => initState());

        if (err) {

            throw new RpcError('Failed to load state', err.message);

        }

        const summaries = manager.listConfigs();

        // Invisibility: a config with access.mcp === false does not exist
        // as far as the mcp channel is concerned.
        if (session.channel === 'mcp') {

            return summaries.filter((summary) => summary.access.mcp !== false);

        }

        return summaries;

    },
};

/** Configuration management commands exposed over RPC. */
export const configCommands: RpcCommand[] = [listConfigsCommand as RpcCommand];
