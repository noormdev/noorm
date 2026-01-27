/**
 * Secret resolution.
 *
 * Resolves secrets with the proper priority order:
 * 1. Config-specific local secrets (most specific)
 * 2. Global local secrets (shared across configs, stored in state)
 * 3. Vault secrets (team-shared, database)
 *
 * Local always wins over remote.
 */
import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../shared/tables.js';
import type { StateManager } from '../state/manager.js';

import { getVaultSecret } from './storage.js';

/**
 * Resolve a secret value.
 *
 * Checks in priority order:
 * 1. Config-specific local secret
 * 2. Global local secret
 * 3. Vault secret (if vault key is available)
 *
 * @param stateManager - State manager for local secrets
 * @param configName - Config name for config-specific secrets
 * @param secretKey - The secret key to resolve
 * @param db - Optional Kysely instance for vault access
 * @param vaultKey - Optional vault key for vault access
 * @returns The resolved secret value, or null if not found
 *
 * @example
 * ```typescript
 * const apiKey = await resolveSecret(
 *     stateManager,
 *     'production',
 *     'API_KEY',
 *     db,
 *     vaultKey,
 * );
 * ```
 */
export async function resolveSecret(
    stateManager: StateManager,
    configName: string,
    secretKey: string,
    db?: Kysely<NoormDatabase> | null,
    vaultKey?: Buffer | null,
): Promise<string | null> {

    // 1. Config-specific local secret (highest priority)
    const configSecret = stateManager.getSecret(configName, secretKey);

    if (configSecret) return configSecret;

    // 2. Global local secret
    const globalSecret = stateManager.getGlobalSecret(secretKey);

    if (globalSecret) return globalSecret;

    // 3. Vault secret (lowest priority - team-shared)
    if (db && vaultKey) {

        const vaultValue = await getVaultSecret(db, vaultKey, secretKey);

        if (vaultValue) return vaultValue;

    }

    return null;

}

/**
 * Resolve multiple secrets.
 *
 * @param stateManager - State manager for local secrets
 * @param configName - Config name for config-specific secrets
 * @param secretKeys - Array of secret keys to resolve
 * @param db - Optional Kysely instance for vault access
 * @param vaultKey - Optional vault key for vault access
 * @returns Map of key to resolved value (null values excluded)
 *
 * @example
 * ```typescript
 * const secrets = await resolveSecrets(
 *     stateManager,
 *     'production',
 *     ['API_KEY', 'DB_PASSWORD'],
 *     db,
 *     vaultKey,
 * );
 * ```
 */
export async function resolveSecrets(
    stateManager: StateManager,
    configName: string,
    secretKeys: string[],
    db?: Kysely<NoormDatabase> | null,
    vaultKey?: Buffer | null,
): Promise<Record<string, string>> {

    const result: Record<string, string> = {};

    for (const key of secretKeys) {

        const value = await resolveSecret(stateManager, configName, key, db, vaultKey);

        if (value !== null) {

            result[key] = value;

        }

    }

    return result;

}

/**
 * Build a complete secrets context for template rendering.
 *
 * Merges all secret sources in priority order:
 * 1. Vault secrets (base layer)
 * 2. Global local secrets (override vault)
 * 3. Config-specific secrets (override global)
 *
 * @param stateManager - State manager for local secrets
 * @param configName - Config name for config-specific secrets
 * @param db - Optional Kysely instance for vault access
 * @param vaultKey - Optional vault key for vault access
 * @returns Complete secrets map for template context
 *
 * @example
 * ```typescript
 * const secrets = await buildSecretsContext(
 *     stateManager,
 *     'production',
 *     db,
 *     vaultKey,
 * );
 * // Use in template: <%= secrets.API_KEY %>
 * ```
 */
export async function buildSecretsContext(
    stateManager: StateManager,
    configName: string,
    db?: Kysely<NoormDatabase> | null,
    vaultKey?: Buffer | null,
): Promise<Record<string, string>> {

    const secrets: Record<string, string> = {};

    // 1. Start with vault secrets (lowest priority)
    if (db && vaultKey) {

        const { getAllVaultSecrets } = await import('./storage.js');
        const vaultSecrets = await getAllVaultSecrets(db, vaultKey);

        for (const [key, secret] of Object.entries(vaultSecrets)) {

            secrets[key] = secret.value;

        }

    }

    // 2. Override with global local secrets
    const globalSecretKeys = stateManager.listGlobalSecrets();

    for (const key of globalSecretKeys) {

        const value = stateManager.getGlobalSecret(key);
        if (value) secrets[key] = value;

    }

    // 3. Override with config-specific secrets (highest priority)
    const configSecretKeys = stateManager.listSecrets(configName);

    for (const key of configSecretKeys) {

        const value = stateManager.getSecret(configName, key);
        if (value) secrets[key] = value;

    }

    return secrets;

}
