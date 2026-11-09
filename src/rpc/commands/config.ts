import { z } from 'zod';
import { attempt } from '@logosdx/utils';

import { listVisibleConfigs } from '../../core/state/index.js';
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

        const [summaries, err] = await attempt(() => listVisibleConfigs(process.cwd(), session.channel));

        if (err) {

            throw new RpcError('Failed to load state', err.message);

        }

        return summaries;

    },
};

/** Configuration management commands exposed over RPC. */
export const configCommands: RpcCommand[] = [listConfigsCommand as RpcCommand];
