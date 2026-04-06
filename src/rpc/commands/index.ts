import type { RpcRegistry } from '../registry.js';

import { sessionCommands } from './session.js';
import { configCommands } from './config.js';
import { exploreCommands } from './explore.js';
import { queryCommands } from './query.js';
import { changesCommands } from './changes.js';
import { runCommands } from './run.js';

/**
 * Register all RPC commands into the registry.
 */
export function registerAllCommands(registry: RpcRegistry): void {

    const allCommands = [
        ...sessionCommands,
        ...configCommands,
        ...exploreCommands,
        ...queryCommands,
        ...changesCommands,
        ...runCommands,
    ];

    for (const command of allCommands) {

        registry.register(command);

    }

}
