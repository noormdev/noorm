/**
 * VaultRemoveScreen - delete a vault secret.
 *
 * Confirms deletion before removing.
 */
import { useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, useToast } from '../../components/index.js';
import { useVaultConnection } from '../../hooks/index.js';
import { loadPrivateKey } from '../../../core/identity/storage.js';
import { getVaultKey, deleteVaultSecret, vaultSecretExists } from '../../../core/vault/index.js';


type Phase = 'connecting' | 'ready' | 'deleting' | 'error';

/**
 * VaultRemoveScreen component.
 */
export function VaultRemoveScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('VaultRemove');
    const { activeConfigName, identity } = useAppContext();
    const { showToast } = useToast();

    const { phase: basePhase, error, connRef, setPhase: setBasePhase, setError } = useVaultConnection();
    const phase = basePhase as Phase;
    const setPhase = setBasePhase as (p: Phase) => void;

    const secretKey = params.name;

    // Handle deletion
    const handleDelete = useCallback(async () => {

        if (!connRef.current || !identity || !secretKey) return;

        setPhase('deleting');
        setError(null);

        const [privateKey, privateKeyErr] = await attempt(() => loadPrivateKey());

        if (privateKeyErr) {

            setError(privateKeyErr.message);
            setPhase('ready');

            return;

        }

        if (!privateKey) {

            setError('Failed to load private key');
            setPhase('ready');

            return;

        }

        const db = connRef.current.db;
        const connDialect = connRef.current.dialect;

        const [vaultKey, vaultKeyErr] = await attempt(() => getVaultKey(db as Kysely<NoormDatabase>, identity.identityHash, privateKey, connDialect));

        if (vaultKeyErr) {

            setError(vaultKeyErr.message);
            setPhase('ready');

            return;

        }

        if (!vaultKey) {

            setError('No vault access');
            setPhase('ready');

            return;

        }

        // Check if exists
        const [exists, existsErr] = await attempt(() => vaultSecretExists(db as Kysely<NoormDatabase>, secretKey, connDialect));

        if (existsErr) {

            setError(existsErr.message);
            setPhase('ready');

            return;

        }

        if (!exists) {

            setError(`Secret "${secretKey}" not found in vault`);
            setPhase('ready');

            return;

        }

        const [, err] = await attempt(async () => {

            const [, deleteErr] = await deleteVaultSecret(db as Kysely<NoormDatabase>, secretKey, connDialect);

            if (deleteErr) throw deleteErr;

        });

        if (err) {

            setError(err.message);
            setPhase('ready');

            return;

        }

        showToast({
            message: `Vault secret "${secretKey}" deleted`,
            variant: 'success',
        });
        back();

    }, [identity, secretKey, showToast, back, connRef, setPhase, setError]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused || phase !== 'ready') return;

        if (key.escape || input === 'n' || input === 'N') {

            back();

            return;

        }

        if (key.return || input === 'y' || input === 'Y') {

            handleDelete();

        }

    });

    // No secret key provided
    if (!secretKey) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Vault Secret" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">No secret key provided.</Text>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // No identity
    if (!identity) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Vault Secret" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">{error ?? 'Identity not available'}</Text>
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
                <Panel title="Delete Vault Secret" paddingX={2} paddingY={1}>
                    <Spinner label="Connecting..." />
                </Panel>
            </Box>
        );

    }

    // Error (fatal)
    if (phase === 'error' && !connRef.current) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Vault Secret" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">{error}</Text>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Deleting
    if (phase === 'deleting') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Vault Secret" paddingX={2} paddingY={1}>
                    <Spinner label="Deleting..." />
                </Panel>
            </Box>
        );

    }

    // Ready - show confirmation
    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={`Delete Vault Secret: ${secretKey}`} paddingX={2} paddingY={1} borderColor="red">
                <Box flexDirection="column" gap={1}>
                    <Text dimColor>Config: {activeConfigName}</Text>

                    {error ? (
                        <Box flexDirection="column" gap={1}>
                            <Text color="red">{error}</Text>
                            <Text dimColor>Press Enter to retry or Esc to cancel.</Text>
                        </Box>
                    ) : (
                        <Box flexDirection="column" gap={1}>
                            <Text color="yellow">
                                Are you sure you want to delete vault secret "{secretKey}"?
                            </Text>
                            <Text dimColor>This action cannot be undone.</Text>
                        </Box>
                    )}
                </Box>
            </Panel>

            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[y/Enter] Delete</Text>
                <Text dimColor>[n/Esc] Cancel</Text>
            </Box>
        </Box>
    );

}
