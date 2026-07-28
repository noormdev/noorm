/**
 * Builds a RunContext from screen-level dependencies.
 *
 * Eliminates the repeated 7-field object literal that appears
 * in every run screen's execute callback.
 *
 * @example
 * ```typescript
 * const context = await buildRunContext({ db, configName, identity, projectRoot, activeConfig, stateManager });
 * await runFile(context, selectedFile, options);
 * ```
 */
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';

import type { RunContext } from '../../core/runner/types.js';
import type { Dialect } from '../../core/connection/types.js';
import type { NoormDatabase } from '../../core/shared/index.js';
import type { Identity } from '../../core/identity/types.js';
import { loadIdentityMetadata, loadPrivateKey } from '../../core/identity/storage.js';
import type { Config } from '../../core/config/types.js';
import type { StateManager } from '../../core/state/index.js';
import { getVaultKey, buildSecretsContext } from '../../core/vault/index.js';

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
 * Resolve the vault key for the current identity, if any.
 *
 * Degrades to `null` on any failure — no identity on disk, no vault
 * access yet, or a decrypt failure all mean the vault tier is
 * unavailable, not that the render should fail. A project with no
 * vault at all must render exactly as it does today.
 */
async function resolveVaultKey(db: Kysely<NoormDatabase>, dialect: Dialect): Promise<Buffer | null> {

    const [vaultKey] = await attempt(async () => {

        const cryptoIdentity = await loadIdentityMetadata();
        const privateKey = cryptoIdentity ? await loadPrivateKey() : null;

        if (!cryptoIdentity || !privateKey) return null;

        return getVaultKey(db, cryptoIdentity.identityHash, privateKey, dialect);

    });

    return vaultKey ?? null;

}

/**
 * Build a RunContext from screen dependencies.
 *
 * Centralizes the repeated pattern of assembling config, secrets,
 * and global secrets into a RunContext object.
 *
 * @example
 * ```typescript
 * const context = await buildRunContext({
 *     db, configName: activeConfigName, identity,
 *     projectRoot, activeConfig, stateManager,
 * });
 * ```
 */
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
        config: activeConfig as unknown as Record<string, unknown>,
        secrets: await buildSecretsContext(stateManager, configName, db, vaultKey, dialect),
        globalSecrets: stateManager.getAllGlobalSecrets(),
    };

}
