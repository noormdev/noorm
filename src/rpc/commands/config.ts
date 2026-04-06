import { z } from 'zod';
import { attempt } from '@logosdx/utils';

import { initState } from '../../core/state/index.js';
import type { ConfigSummary } from '../../core/config/types.js';
import type { RpcCommand } from '../types.js';
import { RpcError } from '../types.js';

const listConfigsCommand: RpcCommand<Record<string, never>, ConfigSummary[]> = {
    name: 'list_configs',
    description: 'List all database configurations with dialect, database name, and protection status. Does not require a database connection.',
    examples: [
        { description: 'list all configs', input: {} },
    ],
    inputSchema: z.object({}),
    handler: async (): Promise<ConfigSummary[]> => {

        const [manager, err] = await attempt(() => initState());

        if (err) {

            throw new RpcError('Failed to load state', err.message);

        }

        return manager.listConfigs();

    },
};

/** Configuration management commands exposed over RPC. */
export const configCommands: RpcCommand[] = [listConfigsCommand as RpcCommand];
