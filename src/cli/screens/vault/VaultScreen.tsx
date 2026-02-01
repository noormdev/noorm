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
import { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Kysely } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';
import type { ConnectionResult } from '../../../core/connection/types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, SelectList, Spinner, useToast, type SelectListItem } from '../../components/index.js';
import { createConnection } from '../../../core/connection/index.js';
import { loadPrivateKey } from '../../../core/identity/storage.js';
import {
    getVaultStatus,
    getVaultKey,
    getAllVaultSecrets,
    propagateVaultKey,
    type VaultStatus,
    type VaultSecret,
} from '../../../core/vault/index.js';
import { ensureSchemaVersion } from '../../../core/version/index.js';


type Phase = 'loading' | 'ready' | 'error';

/**
 * VaultScreen component.
 */
export function VaultScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('Vault');
    const { activeConfig, activeConfigName, identity, settings } = useAppContext();
    const { showToast } = useToast();

    const [phase, setPhase] = useState<Phase>('loading');
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<VaultStatus | null>(null);
    const [secrets, setSecrets] = useState<VaultSecret[]>([]);
    const [propagating, setPropagating] = useState(false);

    // Connection ref for cleanup
    const connRef = useRef<ConnectionResult | null>(null);
    const loadingRef = useRef(false);

    // Load vault data
    useEffect(() => {

        if (!activeConfig || !activeConfigName || !identity) {

            if (!activeConfig) setError('No active configuration');
            else if (!identity) setError('Identity not set up');
            setPhase('error');

            return;

        }

        if (loadingRef.current) return;
        loadingRef.current = true;

        let cancelled = false;

        const load = async (): Promise<void> => {

            // Create connection
            const [conn, connErr] = await attempt(() =>
                createConnection(activeConfig.connection, activeConfigName),
            );

            if (connErr || !conn) {

                if (!cancelled) {

                    setError(`Connection failed: ${connErr?.message ?? 'Unknown error'}`);
                    setPhase('error');

                }

                return;

            }

            connRef.current = conn;

            if (cancelled) {

                await conn.destroy();

                return;

            }

            const db = conn.db;

            // Ensure schema and identity are registered
            await ensureSchemaVersion(db as Kysely<NoormDatabase>, conn.dialect);

            if (cancelled) {

                await conn.destroy();

                return;

            }

            // Get vault status
            const vaultStatus = await getVaultStatus(db as Kysely<NoormDatabase>, identity.identityHash);

            if (cancelled) {

                await conn.destroy();

                return;

            }

            setStatus(vaultStatus);

            // Load secrets if we have access
            if (vaultStatus.hasAccess) {

                const [privateKey] = await Promise.all([loadPrivateKey()]);

                if (privateKey && !cancelled) {

                    const vaultKey = await getVaultKey(db as Kysely<NoormDatabase>, identity.identityHash, privateKey);

                    if (vaultKey && !cancelled) {

                        const allSecrets = await getAllVaultSecrets(db as Kysely<NoormDatabase>, vaultKey);
                        setSecrets(Object.values(allSecrets));

                    }

                }

            }

            if (!cancelled) {

                setPhase('ready');

            }

        };

        load();

        return () => {

            cancelled = true;

            if (connRef.current) {

                connRef.current.destroy();
                connRef.current = null;

            }

        };

    }, [activeConfig, activeConfigName, identity]);

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
        const vaultKey = await getVaultKey(db as Kysely<NoormDatabase>, identity.identityHash, privateKey);

        if (!vaultKey) {

            showToast({ message: 'No vault access', variant: 'error' });
            setPropagating(false);

            return;

        }

        const result = await propagateVaultKey(db as Kysely<NoormDatabase>, vaultKey);

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
        const newStatus = await getVaultStatus(db as Kysely<NoormDatabase>, identity.identityHash);
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
    if (!activeConfigName || !activeConfig) {

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

    // Loading
    if (phase === 'loading') {

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
