/**
 * State module exports.
 *
 * Provides StateManager class and singleton helpers.
 */
import { StateManager } from './manager.js';
import { resolve } from 'node:path';

export { StateManager };
export { InvalidSecretKeyError, isValidSecretKey } from './manager.js';
export type { StateManagerOptions } from './manager.js';
export * from './types.js';
export { migrateState, needsMigration } from './migrations.js';
export { BACKUP_SUFFIX, LOCK_SUFFIX, StateLockTimeoutError } from './persistence.js';
export { getPackageVersion } from './version.js';

let instance: StateManager | null = null;
const instances = new Map<string, StateManager>();

/**
 * Get the active StateManager, or select the manager for an explicit project root.
 *
 * @example
 * ```typescript
 * const state = getStateManager()
 * // Must call load() if not already loaded
 * ```
 */
export function getStateManager(projectRoot?: string): StateManager {

    if (projectRoot !== undefined || !instance) {

        const root = resolve(projectRoot ?? process.cwd());
        instance = instances.get(root) ?? new StateManager(root);
        instances.set(root, instance);

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
    instances.clear();

}
