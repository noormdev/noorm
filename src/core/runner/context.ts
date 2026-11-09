import type { Kysely } from 'kysely';

import type { Config } from '../config/types.js';
import type { Dialect } from '../connection/types.js';
import type { Identity } from '../identity/types.js';
import type { NoormDatabase } from '../shared/tables.js';
import type { StateManager } from '../state/index.js';
import { buildSecretsContext, resolveVaultKey } from '../vault/index.js';
import type { RunContext } from './types.js';

/** Dependencies a caller already holds when it needs a {@link RunContext}. */
export interface BuildRunContextOptions {
    db: Kysely<NoormDatabase>;
    configName: string;
    identity: Identity;
    projectRoot: string;
    activeConfig: Config;
    stateManager: StateManager;
    dialect?: Dialect;
}

/** Builds a RunContext on the `user` channel, resolving the vault key and both secret tiers. */
export async function buildRunContext(options: BuildRunContextOptions): Promise<RunContext> {

    const { db, configName, identity, projectRoot, activeConfig, stateManager, dialect } = options;

    const vaultKey = dialect ? await resolveVaultKey(db, dialect) : null;

    return {
        db,
        configName,
        identity,
        projectRoot,
        dialect,
        access: activeConfig.access,
        channel: 'user',
        config: activeConfig,
        secrets: await buildSecretsContext(stateManager, configName, db, vaultKey, dialect),
        globalSecrets: stateManager.getAllGlobalSecrets(),
    };

}
