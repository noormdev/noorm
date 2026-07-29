/**
 * Hook for loading vault secret keys and required secrets.
 *
 * Extracts the identical vault-loading pattern from SecretSetScreen,
 * SecretRemoveScreen, and SecretListScreen: connect → getVaultStatus →
 * loadPrivateKey → getVaultKey → getAllVaultSecrets.
 *
 * @example
 * ```tsx
 * const { vaultSecretKeys, requiredSecrets, vaultError } = useVaultSecretKeys();
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

    /**
     * Message describing a failed vault read, or null.
     *
     * Only set when a vault call actually threw. Absent-vault states — no
     * access, no private key on disk, no vault key row — resolve to null so
     * projects that never adopted the vault stay silent.
     */
    vaultError: string | null;

}

/**
 * Loads vault secret keys and required secrets for the active config.
 *
 * Delegates to the shared useConnection hook for connection management.
 * Loads vault secrets once the connection is ready.
 *
 * Separates "nothing to load" from "the load failed" so a decrypt or
 * permissions failure cannot masquerade as an empty vault — callers render
 * `vaultError` to explain why vault-backed secrets are missing.
 */
export function useVaultSecretKeys(): VaultSecretKeysResult {

    const { activeConfig, activeConfigName, settingsManager, identity } = useAppContext();
    const [vaultSecretKeys, setVaultSecretKeys] = useState<string[]>([]);
    const [vaultError, setVaultError] = useState<string | null>(null);

    // Shared connection with schema ensured (vault needs __noorm_* tables)
    const { db, dialect, loading: connLoading, error: connError } = useConnection({ ensureSchema: true });

    // Load vault secrets when connection is ready
    useEffect(() => {

        if (!activeConfig || !activeConfigName || !identity) return;
        if (!db || !dialect || connLoading || connError) return;

        let cancelled = false;

        const loadVaultSecrets = async (): Promise<void> => {

            const typedDb = db as Kysely<NoormDatabase>;

            setVaultError(null);

            const [vaultStatus, statusErr] = await attempt(() =>
                getVaultStatus(typedDb, identity.identityHash, dialect),
            );

            if (cancelled) return;

            if (statusErr) {

                setVaultError(`Could not read vault status: ${statusErr.message}`);

                return;

            }

            if (!vaultStatus?.hasAccess) return;

            const [privateKey, pkErr] = await attempt(() => loadPrivateKey());

            if (cancelled) return;

            if (pkErr) {

                setVaultError(`Could not load private key: ${pkErr.message}`);

                return;

            }

            if (!privateKey) return;

            const [vaultKey, vkErr] = await attempt(() =>
                getVaultKey(typedDb, identity.identityHash, privateKey, dialect),
            );

            if (cancelled) return;

            if (vkErr) {

                setVaultError(`Could not unlock vault: ${vkErr.message}`);

                return;

            }

            if (!vaultKey) return;

            const [allSecrets, secretsErr] = await attempt(() =>
                getAllVaultSecrets(typedDb, vaultKey, dialect),
            );

            if (cancelled) return;

            if (secretsErr) {

                setVaultError(`Could not read vault secrets: ${secretsErr.message}`);

                return;

            }

            setVaultSecretKeys(Object.keys(allSecrets ?? {}));

        };

        loadVaultSecrets();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, identity, db, dialect, connLoading, connError]);

    // Get required secrets (universal + stage-specific merged)
    const requiredSecrets = useMemo(() => {

        if (!activeConfigName || !settingsManager) return [];

        return settingsManager.getRequiredSecrets(activeConfigName);

    }, [activeConfigName, settingsManager]);

    return { vaultSecretKeys, requiredSecrets, vaultError };

}
