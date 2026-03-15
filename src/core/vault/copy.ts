/**
 * Vault secret copy operations.
 *
 * Copies vault secrets between different database configs.
 * Uses the dual connection infrastructure for cross-database operations.
 */
import { withDualConnection } from '../db/dual.js';
import type { Config } from '../config/types.js';
import { observer } from '../observer.js';

import type { VaultCopyResult } from './types.js';
import {
    getVaultKey,
    getAllVaultSecrets,
    setVaultSecret,
    vaultSecretExists,
    initializeVault,
    getVaultStatus,
} from './storage.js';

/**
 * Options for vault copy operation.
 */
export interface VaultCopyOptions {
    /** Overwrite existing secrets in destination (default: false) */
    force?: boolean;
}

/**
 * Copy vault secrets between configs.
 *
 * Requires vault access on both source and destination.
 * If destination vault is not initialized, initializes it automatically.
 *
 * @param sourceConfig - Source config object
 * @param destConfig - Destination config object
 * @param keys - Array of secret keys to copy, or 'all' for all secrets
 * @param identityHash - Current user's identity hash
 * @param privateKey - Current user's private key (hex)
 * @param publicKey - Current user's public key (hex)
 * @param options - Copy options
 *
 * @example
 * ```typescript
 * // Copy specific secrets
 * const [result, err] = await copyVaultSecrets(
 *     sourceConfig,
 *     destConfig,
 *     ['API_KEY', 'DB_PASSWORD'],
 *     identity.identityHash,
 *     privateKey,
 *     identity.publicKey,
 *     { force: false },
 * );
 *
 * // Copy all secrets
 * const [result, err] = await copyVaultSecrets(
 *     sourceConfig,
 *     destConfig,
 *     'all',
 *     identity.identityHash,
 *     privateKey,
 *     identity.publicKey,
 * );
 * ```
 */
export async function copyVaultSecrets(
    sourceConfig: Config,
    destConfig: Config,
    keys: string[] | 'all',
    identityHash: string,
    privateKey: string,
    publicKey: string,
    options: VaultCopyOptions = {},
): Promise<[VaultCopyResult | null, Error | null]> {

    const { force = false } = options;

    observer.emit('vault:copy:starting', {
        source: sourceConfig.name,
        destination: destConfig.name,
        keys: keys === 'all' ? 'all' : keys.length,
    });

    return withDualConnection(
        { sourceConfig, destConfig },
        async (ctx) => {

            // Get vault key from source
            const sourceVaultKey = await getVaultKey(
                ctx.source.db,
                identityHash,
                privateKey,
                ctx.source.dialect,
            );

            if (!sourceVaultKey) {

                throw new Error(`No vault access on source config "${sourceConfig.name}"`);

            }

            // Check destination vault status
            const destStatus = await getVaultStatus(ctx.destination.db, identityHash, ctx.destination.dialect);
            let destVaultKey: Buffer | null = null;

            if (!destStatus.isInitialized) {

                // Initialize vault on destination
                const [newKey, initErr] = await initializeVault(
                    ctx.destination.db,
                    identityHash,
                    publicKey,
                    ctx.destination.dialect,
                );

                if (initErr) {

                    throw new Error(`Failed to initialize vault on destination: ${initErr.message}`);

                }

                destVaultKey = newKey;

            }
            else if (!destStatus.hasAccess) {

                throw new Error(`No vault access on destination config "${destConfig.name}"`);

            }
            else {

                destVaultKey = await getVaultKey(
                    ctx.destination.db,
                    identityHash,
                    privateKey,
                    ctx.destination.dialect,
                );

            }

            if (!destVaultKey) {

                throw new Error('Failed to get vault key for destination');

            }

            // Fetch secrets from source
            const allSourceSecrets = await getAllVaultSecrets(ctx.source.db, sourceVaultKey, ctx.source.dialect);
            const secretsToCopy = keys === 'all'
                ? Object.entries(allSourceSecrets)
                : Object.entries(allSourceSecrets).filter(([key]) => keys.includes(key));

            const result: VaultCopyResult = {
                copied: [],
                skipped: [],
                errors: [],
            };

            // Check for keys that don't exist in source
            if (keys !== 'all') {

                for (const key of keys) {

                    if (!allSourceSecrets[key]) {

                        result.errors.push({
                            key,
                            error: `Secret "${key}" not found in source vault`,
                        });

                    }

                }

            }

            // Copy each secret to destination
            for (const [key, secret] of secretsToCopy) {

                const exists = await vaultSecretExists(ctx.destination.db, key, ctx.destination.dialect);

                if (exists && !force) {

                    result.skipped.push(key);
                    continue;

                }

                const setBy = `copied from ${sourceConfig.name}`;
                const [, setErr] = await setVaultSecret(
                    ctx.destination.db,
                    destVaultKey,
                    key,
                    secret.value,
                    setBy,
                    ctx.destination.dialect,
                );

                if (setErr) {

                    result.errors.push({ key, error: setErr.message });

                }
                else {

                    result.copied.push(key);

                }

            }

            observer.emit('vault:copy:completed', {
                source: sourceConfig.name,
                destination: destConfig.name,
                copied: result.copied.length,
                skipped: result.skipped.length,
                errors: result.errors.length,
            });

            return result;

        },
    );

}
