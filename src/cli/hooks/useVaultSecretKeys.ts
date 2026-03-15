/**
 * Hook for loading vault secret keys and required secrets.
 *
 * Extracts the identical vault-loading pattern from SecretSetScreen,
 * SecretRemoveScreen, and SecretListScreen: connect → getVaultStatus →
 * loadPrivateKey → getVaultKey → getAllVaultSecrets.
 *
 * @example
 * ```tsx
 * const { vaultSecretKeys, requiredSecrets } = useVaultSecretKeys();
 * ```
 */
import { useState, useMemo, useEffect } from 'react';
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { NoormDatabase } from '../../core/shared/index.js';

import { useAppContext } from '../app-context.js';
import { useConnection } from './useConnection.js';
import { getVaultStatus, getVaultKey, getAllVaultSecrets } from '../../core/vault/index.js';
import { loadPrivateKey } from '../../core/identity/storage.js';


/**
 * Result from useVaultSecretKeys hook.
 */
export interface VaultSecretKeysResult {

    /** Keys of all secrets stored in the vault. */
    vaultSecretKeys: string[];

    /** Required secrets for the current stage (from settings). */
    requiredSecrets: { key: string; type: string; description?: string }[];

}

/**
 * Loads vault secret keys and required secrets for the active config.
 *
 * Delegates to the shared useConnection hook for connection management.
 * Loads vault secrets once the connection is ready.
 */
export function useVaultSecretKeys(): VaultSecretKeysResult {

    const { activeConfig, activeConfigName, settingsManager, identity } = useAppContext();
    const [vaultSecretKeys, setVaultSecretKeys] = useState<string[]>([]);

    // Shared connection with schema ensured (vault needs __noorm_* tables)
    const { db, dialect, loading: connLoading, error: connError } = useConnection({ ensureSchema: true });

    // Load vault secrets when connection is ready
    useEffect(() => {

        if (!activeConfig || !activeConfigName || !identity) return;
        if (!db || !dialect || connLoading || connError) return;

        let cancelled = false;

        const loadVaultSecrets = async (): Promise<void> => {

            const typedDb = db as Kysely<NoormDatabase>;

            const [vaultStatus, statusErr] = await attempt(() =>
                getVaultStatus(typedDb, identity.identityHash, dialect),
            );

            if (statusErr || !vaultStatus?.hasAccess || cancelled) return;

            const [privateKey, pkErr] = await attempt(() => loadPrivateKey());

            if (pkErr || !privateKey || cancelled) return;

            const [vaultKey, vkErr] = await attempt(() =>
                getVaultKey(typedDb, identity.identityHash, privateKey, dialect),
            );

            if (vkErr || !vaultKey || cancelled) return;

            const [allSecrets, secretsErr] = await attempt(() =>
                getAllVaultSecrets(typedDb, vaultKey, dialect),
            );

            if (!secretsErr && allSecrets && !cancelled) {

                setVaultSecretKeys(Object.keys(allSecrets));

            }

        };

        loadVaultSecrets();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, identity, db, connLoading, connError]);

    // Get required secrets (universal + stage-specific merged)
    const requiredSecrets = useMemo(() => {

        if (!activeConfigName || !settingsManager) return [];

        return settingsManager.getRequiredSecrets(activeConfigName);

    }, [activeConfigName, settingsManager]);

    return { vaultSecretKeys, requiredSecrets };

}
