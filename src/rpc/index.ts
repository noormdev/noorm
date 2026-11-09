export { RpcRegistry } from './registry.js';
export { RpcError } from './types.js';
export { registerAllCommands } from './commands/index.js';
export type { RpcCommand, RpcExample, RpcCommandInfo, RpcSession } from './types.js';

import { RpcRegistry } from './registry.js';
import { registerAllCommands } from './commands/index.js';

/**
 * Create a fully populated RPC registry.
 */
export function createRegistry(): RpcRegistry {

    const registry = new RpcRegistry();
    registerAllCommands(registry);

    return registry;

}
