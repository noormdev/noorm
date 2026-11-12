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
import { Hotkey, KeyTarget } from '../../components/layout/Hotkey.js';

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
    const [pendingRead, setPendingRead] = useState<'propagate' | null>(null);
    const [readApproved, setReadApproved] = useState(false);
    const readCheck = activeConfig ? checkConfigPolicy('user', activeConfig, 'vault:read') : null;
    const writeCheck = activeConfig ? checkConfigPolicy('user', activeConfig, 'vault:write') : null;

    // Non-null while awaiting confirmation, and holds exactly who would be
    // granted the vault key — propagation used to run on the bare `p`
    // keypress, which named nobody.
    const [pendingRecipients, setPendingRecipients] = useState<PropagationRecipient[] | null>(null);

    const propagateCheck = useMemo(
        () => (activeConfig ? checkConfigPolicy('user', activeConfig, 'vault:propagate') : null),
        [activeConfig],
    );

    const { phase, error, connRef } = useVaultConnection({
        enabled: !!readCheck?.allowed && (!readCheck.requiresConfirmation || readApproved),
        onReady: async (db, isCancelled, dialect) => {

            if (!identity) return;

            if (!activeConfig) return;
            await loadVault(db as Kysely<NoormDatabase>, dialect, isCancelled);

        },
    });
    async function loadVault(db: Kysely<NoormDatabase>, dialect: Parameters<typeof getVaultStatus>[2], isCancelled: () => boolean = () => false) {

        if (!identity) return;
        const vaultStatus = await getVaultStatus(db, identity.identityHash, dialect);
        if (isCancelled()) return;
        setStatus(vaultStatus);
        if (!vaultStatus.hasAccess) return;
        const privateKey = await loadPrivateKey();
        if (!privateKey || isCancelled()) return;
        const vaultKey = await getVaultKey(db, identity.identityHash, privateKey, dialect);
        if (!vaultKey || isCancelled()) return;
        const allSecrets = await getAllVaultSecrets(db, vaultKey, dialect);
        if (!isCancelled()) setSecrets(Object.values(allSecrets));

    }


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

        // Returns its own `[users, error]` tuple rather than throwing, so that a
        // failed lookup cannot be mistaken for "nobody is missing access". Calling
        // it through `attempt` would nest that tuple inside another one.
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
    const handlePropagate = useCallback(async (recipients: PropagationRecipient[]) => {

        if (!connRef.current || !identity) return;

        if (!activeConfig) return;
        const propagationPolicy = checkConfigPolicy('user', activeConfig, 'vault:propagate');
        if (!propagationPolicy.allowed) {

            showToast({ message: propagationPolicy.blockedReason ?? 'Propagating vault access is not allowed', variant: 'error' });

            return;

        }
        const check = checkConfigPolicy('user', activeConfig, 'vault:read');
        if (!check.allowed) {

            showToast({ message: check.blockedReason ?? 'Vault read is not allowed', variant: 'error' });

            return;

        }

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

        const [result, propagateErr] = await attempt(() => propagateVaultKey(
            db as Kysely<NoormDatabase>, vaultKey, connDialect, { reviewedRecipients: recipients },
        ));

        if (propagateErr || !result) {

            showToast({ message: propagateErr?.message ?? 'Failed to propagate vault key', variant: 'error' });
            setPropagating(false);

            return;

        }
        if (result.failed.length > 0) {

            showToast({ message: `Granted ${result.propagatedTo.length}; failed ${result.failed.length}. Review recipients again`, variant: 'error' });
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

    }, [activeConfig, identity, showToast]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused || pendingRead || pendingRecipients || (readCheck?.requiresConfirmation && !readApproved)) return;

        if (key.escape) {

            back();

            return;

        }
        if (!readCheck?.allowed) {

            if (input === 'i' && writeCheck?.allowed) navigate('vault/init');

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
                    <Hotkey keys="Esc">Back</Hotkey>
                </Box>
            </Box>
        );

    }
    if (readCheck && !readCheck.allowed) {

        return (
            <Panel title="Vault" borderColor="yellow">
                <Box flexDirection="column">
                    <Text color="yellow">{readCheck.blockedReason ?? 'Vault read is not allowed'}</Text>
                    {writeCheck?.allowed && <Hotkey keys="i" dim={false}>Initialize vault</Hotkey>}
                    <Hotkey keys="Esc">Back</Hotkey>
                </Box>
            </Panel>
        );

    }

    if ((pendingRead || (readCheck?.requiresConfirmation && !readApproved)) && readCheck) {

        return (
            <SmartConfirm
                focusLabel="VaultReadConfirm"
                requiresConfirmation
                confirmationPhrase={readCheck.confirmationPhrase}
                configName={activeConfigName ?? 'unknown'}
                action="read vault for"
                message="Read vault secrets?"
                onConfirm={() => {

                    const action = pendingRead;
                    setPendingRead(null);
                    if (!activeConfig || !checkConfigPolicy('user', activeConfig, 'vault:read').allowed) return;
                    if (action === 'propagate' && pendingRecipients) {

                        setPendingRecipients(null);
                        void handlePropagate(pendingRecipients);

                    }
                    else setReadApproved(true);

                }}
                onCancel={() => {

                    if (!readApproved) back();
                    else {

                        setPendingRead(null);
                        setPendingRecipients(null);

                    }

                }}
            />
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
                    <Hotkey keys="Esc">Back</Hotkey>
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
                        <KeyTarget keys="i"><Text>Press [i] to initialize the vault for this database.</Text></KeyTarget>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Hotkey keys="i">Initialize</Hotkey>
                    <Hotkey keys="Esc">Back</Hotkey>
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
                    <Hotkey keys="Esc">Back</Hotkey>
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

                        if (readCheck?.requiresConfirmation) setPendingRead('propagate');
                        else {

                            setPendingRecipients(null);
                            void handlePropagate(pendingRecipients);

                        }

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
                            <KeyTarget keys="a"><Text dimColor>Press [a] to add the first secret.</Text></KeyTarget>
                        </Box>
                    ) : (
                        <SelectList
                            items={listItems}
                            onSelect={(item) => handleEdit(item.value)}
                            isFocused={isFocused}
                            reserveRows={2}
                            showDescriptionBelow
                        />
                    )}
                </Box>
            </Panel>

            {/* Help */}
            <Box flexWrap="wrap" columnGap={2}>
                <Hotkey keys="a">Add</Hotkey>
                {listItems.length > 0 && <Hotkey keys="Enter">Select</Hotkey>}
                {status.usersWithoutAccess > 0 && (
                    propagating ? <Text dimColor>Propagating...</Text> : <Hotkey keys="p">Propagate</Hotkey>
                )}
                <Hotkey keys="Esc">Back</Hotkey>
            </Box>
        </Box>
    );

}
