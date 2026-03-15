/**
 * VaultScreen - main vault secrets list.
 *
 * Displays vault secrets with quick actions.
 * Shows vault status and allows management operations.
 *
 * Keyboard shortcuts:
 * - a: Add/set a secret
 * - d: Delete selected secret
 * - Enter: Edit selected secret value
 * - p: Propagate vault key to new users
 * - i: Initialize vault (if not initialized)
 * - Esc: Go back
 */
import { useCallback, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Kysely } from 'kysely';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, SelectList, Spinner, useToast, type SelectListItem } from '../../components/index.js';
import { useVaultConnection } from '../../hooks/index.js';
import { loadPrivateKey } from '../../../core/identity/storage.js';
import {
    getVaultStatus,
    getVaultKey,
    getAllVaultSecrets,
    propagateVaultKey,
    type VaultStatus,
    type VaultSecret,
} from '../../../core/vault/index.js';


type _Phase = 'connecting' | 'ready' | 'error';

/**
 * VaultScreen component.
 */
export function VaultScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('Vault');
    const { activeConfigName, identity, settings } = useAppContext();
    const { showToast } = useToast();

    const [status, setStatus] = useState<VaultStatus | null>(null);
    const [secrets, setSecrets] = useState<VaultSecret[]>([]);
    const [propagating, setPropagating] = useState(false);

    const { phase, error, connRef } = useVaultConnection({
        onReady: async (db, isCancelled, dialect) => {

            if (!identity) return;

            const vaultStatus = await getVaultStatus(db as Kysely<NoormDatabase>, identity.identityHash, dialect);

            if (isCancelled()) return;

            setStatus(vaultStatus);

            if (vaultStatus.hasAccess) {

                const [privateKey] = await Promise.all([loadPrivateKey()]);

                if (privateKey && !isCancelled()) {

                    const vaultKey = await getVaultKey(db as Kysely<NoormDatabase>, identity.identityHash, privateKey, dialect);

                    if (vaultKey && !isCancelled()) {

                        const allSecrets = await getAllVaultSecrets(db as Kysely<NoormDatabase>, vaultKey, dialect);
                        setSecrets(Object.values(allSecrets));

                    }

                }

            }

        },
    });

    // Get defined secret keys that aren't in the vault
    const unsetDefinedSecrets = useMemo(() => {

        const definedSecrets = settings?.secrets ?? [];
        const vaultKeys = new Set(secrets.map((s) => s.key));

        return definedSecrets.filter((s) => !vaultKeys.has(s.key));

    }, [settings, secrets]);

    // Convert secrets to list items (vault secrets + unset defined secrets)
    const listItems = useMemo<SelectListItem<string>[]>(() => {

        const vaultItems = secrets.map((secret) => ({
            key: secret.key,
            label: secret.key,
            value: secret.key,
            description: `Set by ${secret.setBy}`,
            icon: '●',
        }));

        const unsetItems = unsetDefinedSecrets.map((s) => ({
            key: `unset:${s.key}`,
            label: s.key,
            value: s.key,
            description: s.description ?? 'Not in vault',
            icon: '○',
        }));

        return [...vaultItems, ...unsetItems];

    }, [secrets, unsetDefinedSecrets]);

    // Handle add
    const handleAdd = useCallback(() => {

        navigate('vault/set');

    }, [navigate]);

    // Handle edit
    const handleEdit = useCallback(
        (key: string) => {

            navigate('vault/set', { name: key });

        },
        [navigate],
    );

    // Handle delete
    const _handleDelete = useCallback(
        (key: string) => {

            navigate('vault/rm', { name: key });

        },
        [navigate],
    );

    // Handle propagate
    const handlePropagate = useCallback(async () => {

        if (!connRef.current || !identity) return;

        setPropagating(true);

        const [privateKey] = await Promise.all([loadPrivateKey()]);

        if (!privateKey) {

            showToast({ message: 'Failed to load private key', variant: 'error' });
            setPropagating(false);

            return;

        }

        const db = connRef.current.db;
        const connDialect = connRef.current.dialect;
        const vaultKey = await getVaultKey(db as Kysely<NoormDatabase>, identity.identityHash, privateKey, connDialect);

        if (!vaultKey) {

            showToast({ message: 'No vault access', variant: 'error' });
            setPropagating(false);

            return;

        }

        const result = await propagateVaultKey(db as Kysely<NoormDatabase>, vaultKey, connDialect);

        if (result.propagatedTo.length > 0) {

            showToast({
                message: `Granted vault access to ${result.propagatedTo.length} users`,
                variant: 'success',
            });

        }
        else {

            showToast({ message: 'All users already have vault access', variant: 'info' });

        }

        // Refresh status
        const newStatus = await getVaultStatus(db as Kysely<NoormDatabase>, identity.identityHash, connDialect);
        setStatus(newStatus);
        setPropagating(false);

    }, [identity, showToast]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        if (input === 'a') {

            handleAdd();

            return;

        }

        if (input === 'p' && status?.hasAccess && !propagating) {

            handlePropagate();

            return;

        }

        if (input === 'i' && !status?.isInitialized) {

            navigate('vault/init');

            return;

        }

    });

    // No active config
    if (!activeConfigName) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Vault" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">No active configuration.</Text>
                        <Text>Set an active config first with: noorm config use &lt;name&gt;</Text>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Connecting
    if (phase === 'connecting') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Vault" paddingX={2} paddingY={1}>
                    <Spinner label="Loading vault..." />
                </Panel>
            </Box>
        );

    }

    // Error
    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Vault" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">{error}</Text>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Vault not initialized
    if (!status?.isInitialized) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Vault" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">Vault not initialized.</Text>
                        <Text>Press [i] to initialize the vault for this database.</Text>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[i] Initialize</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // No vault access
    if (!status?.hasAccess) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Vault" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">You do not have vault access.</Text>
                        <Text>Ask a team member to propagate vault access to you.</Text>
                        <Text dimColor>
                            {status.usersWithAccess} user(s) have access.
                        </Text>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Main vault view
    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={`Vault for "${activeConfigName}"`} paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {/* Status info */}
                    <Box gap={2}>
                        <Text dimColor>
                            {secrets.length} secret(s) | {status.usersWithAccess} user(s) with access
                        </Text>
                        {unsetDefinedSecrets.length > 0 && (
                            <Text color="yellow">
                                {unsetDefinedSecrets.length} not in vault
                            </Text>
                        )}
                        {status.usersWithoutAccess > 0 && (
                            <Text color="yellow">
                                ({status.usersWithoutAccess} pending)
                            </Text>
                        )}
                    </Box>

                    {/* Secret list or empty state */}
                    {listItems.length === 0 ? (
                        <Box flexDirection="column" paddingY={1}>
                            <Text dimColor>No vault secrets yet.</Text>
                            <Text dimColor>Press [a] to add the first secret.</Text>
                        </Box>
                    ) : (
                        <SelectList
                            items={listItems}
                            onSelect={(item) => handleEdit(item.value)}
                            isFocused={isFocused}
                            showDescriptionBelow
                        />
                    )}
                </Box>
            </Panel>

            {/* Help */}
            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[a] Add</Text>
                {listItems.length > 0 && <Text dimColor>[Enter] Select</Text>}
                {status.usersWithoutAccess > 0 && (
                    <Text dimColor>{propagating ? 'Propagating...' : '[p] Propagate'}</Text>
                )}
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
