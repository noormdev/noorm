/**
 * State module exports.
 *
 * Provides StateManager class and singleton helpers.
 */
import { StateManager } from './manager.js';

export { StateManager };
export type { StateManagerOptions } from './manager.js';
export * from './types.js';
export { migrateState, needsMigration } from './migrations.js';
export { getPackageVersion } from './version.js';

let instance: StateManager | null = null;

/**
 * Get or create the StateManager singleton.
 *
 * @example
 * ```typescript
 * const state = getStateManager()
 * // Must call load() if not already loaded
 * ```
 */
export function getStateManager(projectRoot?: string): StateManager {

    if (!instance) {

        const root = projectRoot ?? process.cwd();
        instance = new StateManager(root);

    }

    return instance;

}

/**
 * Initialize the StateManager. Must be called at app startup.
 *
 * @example
 * ```typescript
 * const state = await initState()
 * const config = state.getActiveConfig()
 * ```
 */
export async function initState(projectRoot?: string): Promise<StateManager> {

    const manager = getStateManager(projectRoot);
    await manager.load();

    return manager;

}

/**
 * Reset the singleton (for testing).
 *
 * @example
 * ```typescript
 * beforeEach(() => {
 *     resetStateManager()
 * })
 * ```
 */
export function resetStateManager(): void {

    instance = null;

}
