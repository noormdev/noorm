/**
 * VaultRemoveScreen - delete a vault secret.
 *
 * Confirms deletion before removing.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';
import type { ConnectionResult } from '../../../core/connection/types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, useToast } from '../../components/index.js';
import { createConnection } from '../../../core/connection/index.js';
import { loadPrivateKey } from '../../../core/identity/storage.js';
import { getVaultKey, deleteVaultSecret, vaultSecretExists } from '../../../core/vault/index.js';
import { ensureSchemaVersion } from '../../../core/version/index.js';


type Phase = 'connecting' | 'ready' | 'deleting' | 'error';

/**
 * VaultRemoveScreen component.
 */
export function VaultRemoveScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('VaultRemove');
    const { activeConfig, activeConfigName, identity } = useAppContext();
    const { showToast } = useToast();

    const [phase, setPhase] = useState<Phase>('connecting');
    const [error, setError] = useState<string | null>(null);

    const secretKey = params.name;

    // Connection ref for cleanup
    const connRef = useRef<ConnectionResult | null>(null);
    const loadingRef = useRef(false);

    // Connect on mount
    useEffect(() => {

        if (!activeConfig || !activeConfigName || !identity) {

            if (!activeConfig) setError('No active configuration');
            else if (!identity) setError('Identity not set up');
            setPhase('error');

            return;

        }

        if (!secretKey) {

            setError('No secret key provided');
            setPhase('error');

            return;

        }

        if (loadingRef.current) return;
        loadingRef.current = true;

        let cancelled = false;

        const connect = async (): Promise<void> => {

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

            setPhase('ready');

        };

        connect();

        return () => {

            cancelled = true;

            if (connRef.current) {

                connRef.current.destroy();
                connRef.current = null;

            }

        };

    }, [activeConfig, activeConfigName, identity, secretKey]);

    // Handle deletion
    const handleDelete = useCallback(async () => {

        if (!connRef.current || !identity || !secretKey) return;

        setPhase('deleting');
        setError(null);

        const [privateKey] = await Promise.all([loadPrivateKey()]);

        if (!privateKey) {

            setError('Failed to load private key');
            setPhase('ready');

            return;

        }

        const db = connRef.current.db;
        const vaultKey = await getVaultKey(db as Kysely<NoormDatabase>, identity.identityHash, privateKey);

        if (!vaultKey) {

            setError('No vault access');
            setPhase('ready');

            return;

        }

        // Check if exists
        const exists = await vaultSecretExists(db as Kysely<NoormDatabase>, secretKey);

        if (!exists) {

            setError(`Secret "${secretKey}" not found in vault`);
            setPhase('ready');

            return;

        }

        const [, err] = await attempt(async () => {

            const [, deleteErr] = await deleteVaultSecret(db as Kysely<NoormDatabase>, secretKey);

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

    }, [identity, secretKey, showToast, back]);

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

    // No active config or identity
    if (!activeConfig || !identity) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Vault Secret" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">{error ?? 'Configuration or identity not available'}</Text>
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
