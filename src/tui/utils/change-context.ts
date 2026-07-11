/**
 * Change manager factory for CLI screens.
 *
 * Consolidates the repeated pattern of building a ChangeManager
 * from screen-level context (db, config, settings, identity).
 *
 * @example
 * ```typescript
 * const manager = createChangeManager({
 *     db, configName, projectRoot, settings, cryptoIdentity, activeConfig,
 * });
 * await manager.ff();
 * ```
 */
import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../core/shared/index.js';
import type { Settings } from '../../core/settings/types.js';
import type { CryptoIdentity } from '../../core/identity/types.js';
import type { Config } from '../../core/config/types.js';
import type { ChangeContext } from '../../core/change/types.js';
import { ChangeManager } from '../../core/change/manager.js';
import { resolveChangesDir, resolveSqlDir } from './paths.js';
import { resolveScreenIdentity } from './identity.js';

/**
 * Options for creating a ChangeManager from screen context.
 */
export interface CreateChangeManagerOptions {
    db: Kysely<NoormDatabase>;
    configName: string;
    projectRoot: string;
    settings: Settings | null;
    cryptoIdentity: CryptoIdentity | null | undefined;
    activeConfig: Config;
}

/**
 * Create a ChangeManager from screen-level context.
 *
 * Resolves paths from settings, resolves identity, and builds
 * the ChangeContext needed by the manager.
 *
 * @example
 * ```typescript
 * const manager = createChangeManager({
 *     db, configName: activeConfigName ?? '',
 *     projectRoot, settings, cryptoIdentity,
 * });
 * const result = await manager.ff();
 * ```
 */
export function createChangeManager(options: CreateChangeManagerOptions): ChangeManager {

    const { db, configName, projectRoot, settings, cryptoIdentity, activeConfig } = options;

    const context: ChangeContext = {
        db,
        configName,
        identity: resolveScreenIdentity(cryptoIdentity),
        projectRoot,
        changesDir: resolveChangesDir(projectRoot, settings),
        sqlDir: resolveSqlDir(projectRoot, settings),
        access: activeConfig.access,
        channel: 'user',
    };

    return new ChangeManager(context);

}
