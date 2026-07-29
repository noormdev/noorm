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
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, SelectList, Spinner, SmartConfirm, useToast, type SelectListItem } from '../../components/index.js';
import { useVaultConnection } from '../../hooks/index.js';
import { loadPrivateKey } from '../../../core/identity/storage.js';
import { checkConfigPolicy } from '../../../core/policy/index.js';
import {
    getVaultStatus,
    getVaultKey,
    getAllVaultSecrets,
    propagateVaultKey,
    getUsersWithoutVaultAccess,
    type VaultStatus,
    type VaultSecret,
    type PendingVaultUser,
} from '../../../core/vault/index.js';

/** Recipients of a propagation, as `getUsersWithoutVaultAccess` returns them. */
type PropagationRecipient = PendingVaultUser;


type _Phase = 'connecting' | 'ready' | 'error';

/**
 * VaultScreen component.
 */
export function VaultScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('Vault');
    const { activeConfig, activeConfigName, identity, settings } = useAppContext();
    const { showToast } = useToast();

    const [status, setStatus] = useState<VaultStatus | null>(null);
    const [secrets, setSecrets] = useState<VaultSecret[]>([]);
    const [propagating, setPropagating] = useState(false);

    // Non-null while awaiting confirmation, and holds exactly who would be
    // granted the vault key — propagation used to run on the bare `p`
    // keypress, which named nobody.
    const [pendingRecipients, setPendingRecipients] = useState<PropagationRecipient[] | null>(null);

    const propagateCheck = useMemo(
        () => (activeConfig ? checkConfigPolicy('user', activeConfig, 'vault:propagate') : null),
        [activeConfig],
    );

    const { phase, error, connRef } = useVaultConnection({
        onReady: async (db, isCancelled, dialect) => {

            if (!identity) return;

            const vaultStatus = await getVaultStatus(db as Kysely<NoormDatabase>, identity.identityHash, dialect);

            if (isCancelled()) return;

            setStatus(vaultStatus);

            if (vaultStatus.hasAccess) {

                const privateKey = await loadPrivateKey();

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

    // Resolve who would be granted access, then hand off to the confirmation.
    // Nothing is written here.
    const beginPropagate = useCallback(async () => {

        if (!connRef.current) return;

        if (propagateCheck && !propagateCheck.allowed) {

            showToast({
                message: propagateCheck.blockedReason ?? 'Propagating vault access is not allowed',
                variant: 'error',
            });

            return;

        }

        const db = connRef.current.db;
        const connDialect = connRef.current.dialect;

        // Returns its own [users, err] tuple — no attempt() wrapper, which
        // would nest the tuple inside another one.
        const [recipients, recipientsErr] = await getUsersWithoutVaultAccess(
            db as Kysely<NoormDatabase>,
            connDialect,
        );

        if (recipientsErr) {

            showToast({ message: recipientsErr.message, variant: 'error' });

            return;

        }

        if (!recipients || recipients.length === 0) {

            showToast({ message: 'All users already have vault access', variant: 'info' });

            return;

        }

        setPendingRecipients(recipients);

    }, [connRef, propagateCheck, showToast]);

    // Handle propagate
    const handlePropagate = useCallback(async () => {

        if (!connRef.current || !identity) return;

        setPropagating(true);

        const [privateKey, privateKeyErr] = await attempt(() => loadPrivateKey());

        if (privateKeyErr) {

            showToast({ message: privateKeyErr.message, variant: 'error' });
            setPropagating(false);

            return;

        }

        if (!privateKey) {

            showToast({ message: 'Failed to load private key', variant: 'error' });
            setPropagating(false);

            return;

        }

        const db = connRef.current.db;
        const connDialect = connRef.current.dialect;

        const [vaultKey, vaultKeyErr] = await attempt(() => getVaultKey(db as Kysely<NoormDatabase>, identity.identityHash, privateKey, connDialect));

        if (vaultKeyErr) {

            showToast({ message: vaultKeyErr.message, variant: 'error' });
            setPropagating(false);

            return;

        }

        if (!vaultKey) {

            showToast({ message: 'No vault access', variant: 'error' });
            setPropagating(false);

            return;

        }

        const [result, propagateErr] = await attempt(() => propagateVaultKey(db as Kysely<NoormDatabase>, vaultKey, connDialect));

        if (propagateErr || !result) {

            showToast({ message: propagateErr?.message ?? 'Failed to propagate vault key', variant: 'error' });
            setPropagating(false);

            return;

        }

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
        const [newStatus, statusErr] = await attempt(() => getVaultStatus(db as Kysely<NoormDatabase>, identity.identityHash, connDialect));

        if (statusErr) {

            showToast({ message: statusErr.message, variant: 'error' });
            setPropagating(false);

            return;

        }

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

        if (input === 'p' && status?.hasAccess && !propagating && !pendingRecipients) {

            beginPropagate();

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

    // Confirm propagation. Propagation hands the vault key to every enrolled
    // identity at once, so the recipients are named before it runs.
    if (pendingRecipients) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Grant Vault Access" borderColor="yellow" paddingX={2} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            This grants the vault key for{' '}
                            <Text bold color="cyan">{activeConfigName}</Text> to{' '}
                            <Text bold>{pendingRecipients.length}</Text> user(s):
                        </Text>
                        {pendingRecipients.map((u) => (
                            <Text key={u.identityHash} dimColor>
                                {'  '}{u.name} &lt;{u.email}&gt;
                            </Text>
                        ))}
                        <Text dimColor>They will be able to read every secret in this vault.</Text>
                    </Box>
                </Panel>

                <SmartConfirm
                    focusLabel="VaultPropagateConfirm"
                    requiresConfirmation={propagateCheck?.requiresConfirmation ?? false}
                    confirmationPhrase={propagateCheck?.confirmationPhrase}
                    configName={activeConfigName ?? 'unknown'}
                    action="grant vault access for"
                    message={`Grant vault access to ${pendingRecipients.length} user(s)?`}
                    onConfirm={() => {

                        setPendingRecipients(null);
                        handlePropagate();

                    }}
                    onCancel={() => setPendingRecipients(null)}
                />
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
