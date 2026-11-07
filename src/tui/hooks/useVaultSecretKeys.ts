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
import { checkConfigPolicy, getPolicyFingerprint, withPolicyConfirmation } from '../../core/policy/index.js';


/**
 * Result from useVaultSecretKeys hook.
 */
export interface VaultSecretKeysResult {

    /** Keys of all secrets stored in the vault. */
    vaultSecretKeys: string[];

    /** Required secrets for the current stage (from settings). */
    requiredSecrets: { key: string; type: string; description?: string }[];

    /**
     * Message describing a failed, denied, or cancelled vault read, or null.
     * Absent-vault states — no access, no private key on disk, no vault key
     * row — resolve to null.
     */
    vaultError: string | null;

    /** Confirmation required before loading vault keys, if any. */
    vaultConfirmation: {
        confirmationPhrase?: string;
        configName: string;
        onConfirm: () => void;
        onCancel: () => void;
    } | null;

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
    const [loadedVault, setLoadedVault] = useState<{
        config: typeof activeConfig;
        configName: typeof activeConfigName;
        identity: typeof identity;
        db: unknown;
        fingerprint: string;
        keys: string[];
    } | null>(null);
    const [vaultError, setVaultError] = useState<string | null>(null);
    const [confirmedFingerprint, setConfirmedFingerprint] = useState<string | null>(null);
    const [dismissedFingerprint, setDismissedFingerprint] = useState<string | null>(null);
    const [pendingFingerprint, setPendingFingerprint] = useState<string | null>(null);

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

            const policy = checkConfigPolicy('user', activeConfig, 'vault:read');
            if (!policy.allowed || policy.requiresConfirmation) {

                setVaultError(policy.blockedReason ?? `Vault read requires confirmation (${policy.confirmationPhrase}).`);

                return;

            }
            const fingerprint = getPolicyFingerprint(activeConfig);

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

            if (fingerprint !== getPolicyFingerprint(activeConfig)) return;
            setLoadedVault({ config: activeConfig, configName: activeConfigName, identity, db, fingerprint, keys: Object.keys(allSecrets ?? {}) });

        };

        const policy = checkConfigPolicy('user', activeConfig, 'vault:read');
        const fingerprint = getPolicyFingerprint(activeConfig);
        if (!policy.allowed) {

            setPendingFingerprint(null);
            setVaultError(policy.blockedReason ?? 'Vault read is not allowed.');

        }
        else if (policy.requiresConfirmation && confirmedFingerprint !== fingerprint) {

            if (dismissedFingerprint !== fingerprint) {

                setVaultError(null);
                setPendingFingerprint(fingerprint);

            }

        }
        else if (policy.requiresConfirmation) {

            setPendingFingerprint(null);
            void withPolicyConfirmation(activeConfig, ['vault:read'], loadVaultSecrets);

        }
        else {

            setPendingFingerprint(null);
            void loadVaultSecrets();

        }

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, identity, db, dialect, connLoading, connError, confirmedFingerprint, dismissedFingerprint]);

    // Get required secrets (universal + stage-specific merged)
    const requiredSecrets = useMemo(() => {

        if (!activeConfigName || !settingsManager) return [];

        return settingsManager.getRequiredSecrets(activeConfigName);

    }, [activeConfigName, settingsManager]);

    const vaultSecretKeys = loadedVault?.config === activeConfig
        && loadedVault.configName === activeConfigName
        && loadedVault.identity === identity
        && loadedVault.db === db
        && activeConfig !== null
        && loadedVault.fingerprint === getPolicyFingerprint(activeConfig)
        ? loadedVault.keys
        : [];

    const pendingPolicy = activeConfig && pendingFingerprint === getPolicyFingerprint(activeConfig)
        ? checkConfigPolicy('user', activeConfig, 'vault:read')
        : null;
    const vaultConfirmation = activeConfig && pendingPolicy?.allowed && pendingPolicy.requiresConfirmation
        ? {
            confirmationPhrase: pendingPolicy.confirmationPhrase,
            configName: activeConfig.name,
            onConfirm: () => {

                if (getPolicyFingerprint(activeConfig) !== pendingFingerprint) return;
                setPendingFingerprint(null);
                setConfirmedFingerprint(pendingFingerprint);

            },
            onCancel: () => {

                setPendingFingerprint(null);
                setDismissedFingerprint(pendingFingerprint);
                setVaultError('Vault read cancelled.');

            },
        }
        : null;

    return { vaultSecretKeys, requiredSecrets, vaultError, vaultConfirmation };

}
