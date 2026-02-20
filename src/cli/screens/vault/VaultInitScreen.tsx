/**
 * VaultInitScreen - initialize vault for the current database.
 *
 * Generates a new vault key and stores it for the current user.
 */
import { useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Kysely } from 'kysely';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, useToast } from '../../components/index.js';
import { useVaultConnection } from '../../hooks/index.js';
import { initializeVault, getVaultStatus } from '../../../core/vault/index.js';


type Phase = 'connecting' | 'ready' | 'initializing' | 'error';

/**
 * VaultInitScreen component.
 */
export function VaultInitScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('VaultInit');
    const { activeConfigName, identity } = useAppContext();
    const { showToast } = useToast();

    const { phase: basePhase, error, connRef, setPhase: setBasePhase, setError } = useVaultConnection();
    const phase = basePhase as Phase;
    const setPhase = setBasePhase as (p: Phase) => void;

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

    }, [identity, showToast, back, connRef, setPhase, setError]);

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

    // No identity
    if (!identity) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Initialize Vault" paddingX={2} paddingY={1} borderColor="red">
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
