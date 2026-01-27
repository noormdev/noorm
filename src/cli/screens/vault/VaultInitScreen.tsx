/**
 * VaultInitScreen - initialize vault for the current database.
 *
 * Generates a new vault key and stores it for the current user.
 */
import { useCallback, useState, useRef, useEffect } from 'react';
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
import { Panel, Spinner, useToast } from '../../components/index.js';
import { createConnection } from '../../../core/connection/index.js';
import { initializeVault, getVaultStatus } from '../../../core/vault/index.js';
import { ensureSchemaVersion } from '../../../core/version/index.js';


type Phase = 'connecting' | 'ready' | 'initializing' | 'error';

/**
 * VaultInitScreen component.
 */
export function VaultInitScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('VaultInit');
    const { activeConfig, activeConfigName, identity } = useAppContext();
    const { showToast } = useToast();

    const [phase, setPhase] = useState<Phase>('connecting');
    const [error, setError] = useState<string | null>(null);

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

    }, [activeConfig, activeConfigName, identity]);

    // Handle initialization
    const handleInit = useCallback(async () => {

        if (!connRef.current || !identity) return;

        setPhase('initializing');
        setError(null);

        const db = connRef.current.db;

        // Check if already initialized
        const status = await getVaultStatus(db as Kysely<NoormDatabase>, identity.identityHash);

        if (status.isInitialized) {

            if (status.hasAccess) {

                showToast({ message: 'Vault already initialized', variant: 'info' });

            }
            else {

                showToast({
                    message: 'Vault initialized but you lack access. Ask a team member.',
                    variant: 'warning',
                });

            }

            back();

            return;

        }

        // Initialize vault
        const [, initErr] = await initializeVault(
            db as Kysely<NoormDatabase>,
            identity.identityHash,
            identity.publicKey,
        );

        if (initErr) {

            setError(initErr.message);
            setPhase('ready');

            return;

        }

        showToast({ message: 'Vault initialized successfully', variant: 'success' });
        back();

    }, [identity, showToast, back]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        if (key.return && phase === 'ready') {

            handleInit();

        }

    });

    // No active config or identity
    if (!activeConfig || !identity) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Initialize Vault" paddingX={2} paddingY={1} borderColor="red">
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
                <Panel title="Initialize Vault" paddingX={2} paddingY={1}>
                    <Spinner label="Connecting..." />
                </Panel>
            </Box>
        );

    }

    // Error
    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Initialize Vault" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">{error}</Text>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Initializing
    if (phase === 'initializing') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Initialize Vault" paddingX={2} paddingY={1}>
                    <Spinner label="Initializing vault..." />
                </Panel>
            </Box>
        );

    }

    // Ready - show confirmation
    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Initialize Vault" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text dimColor>Config: {activeConfigName}</Text>
                    <Text>Initialize the vault for this database?</Text>
                    <Text dimColor>
                        This will generate a new encryption key for shared secrets.
                    </Text>
                    <Text dimColor>
                        Other team members will receive access when they connect.
                    </Text>
                </Box>
            </Panel>

            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[Enter] Initialize</Text>
                <Text dimColor>[Esc] Cancel</Text>
            </Box>
        </Box>
    );

}
