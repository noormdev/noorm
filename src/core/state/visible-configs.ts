import { isVisibleToChannel, type Channel } from '../policy/index.js';
import type { ConfigSummary } from '../config/types.js';
import { StateManager } from './manager.js';

/**
 * Lists the configs a channel may see, read fresh from disk.
 * Shared by MCP tools, RPC commands, and resource discovery so they cannot disagree.
 *
 * @example
 * const configs = await listVisibleConfigs(process.cwd(), 'agent');
 */
export async function listVisibleConfigs(projectRoot: string, channel: Channel): Promise<ConfigSummary[]> {

    const state = new StateManager(projectRoot);
    await state.load();

    return state.listConfigs().filter((summary) => isVisibleToChannel(summary.access, channel));

}
