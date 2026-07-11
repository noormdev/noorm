/**
 * Builds a RunContext from screen-level dependencies.
 *
 * Eliminates the repeated 7-field object literal that appears
 * in every run screen's execute callback.
 *
 * @example
 * ```typescript
 * const context = buildRunContext({ db, configName, identity, projectRoot, activeConfig, stateManager });
 * await runFile(context, selectedFile, options);
 * ```
 */
import type { Kysely } from 'kysely';

import type { RunContext } from '../../core/runner/types.js';
import type { Dialect } from '../../core/connection/types.js';
import type { NoormDatabase } from '../../core/shared/index.js';
import type { Identity } from '../../core/identity/types.js';
import type { Config } from '../../core/config/types.js';
import type { StateManager } from '../../core/state/index.js';

/**
 * Options for building a RunContext.
 */
export interface BuildRunContextOptions {
    db: Kysely<NoormDatabase>;
    configName: string;
    identity: Identity;
    projectRoot: string;
    activeConfig: Config;
    stateManager: StateManager;
    dialect?: Dialect;
}

/**
 * Build a RunContext from screen dependencies.
 *
 * Centralizes the repeated pattern of assembling config, secrets,
 * and global secrets into a RunContext object.
 *
 * @example
 * ```typescript
 * const context = buildRunContext({
 *     db, configName: activeConfigName, identity,
 *     projectRoot, activeConfig, stateManager,
 * });
 * ```
 */
export function buildRunContext(options: BuildRunContextOptions): RunContext {

    const { db, configName, identity, projectRoot, activeConfig, stateManager, dialect } = options;

    return {
        db,
        configName,
        identity,
        projectRoot,
        dialect,
        access: activeConfig.access,
        channel: 'user',
        config: activeConfig as unknown as Record<string, unknown>,
        secrets: stateManager.getAllSecrets(configName),
        globalSecrets: stateManager.getAllGlobalSecrets(),
    };

}
