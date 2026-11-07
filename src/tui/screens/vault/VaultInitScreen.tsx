/**
 * VaultInitScreen - initialize vault for the current database.
 *
 * Generates a new vault key and stores it for the current user.
 */
import { useCallback, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Kysely } from 'kysely';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, SmartConfirm, useToast } from '../../components/index.js';
import { useVaultConnection } from '../../hooks/index.js';
import { checkConfigPolicy } from '../../../core/policy/index.js';
import { initializeVault, getVaultStatus } from '../../../core/vault/index.js';


type Phase = 'connecting' | 'ready' | 'initializing' | 'error';

/**
 * VaultInitScreen component.
 */
export function VaultInitScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('VaultInit');
    const { activeConfig, activeConfigName, identity } = useAppContext();
    const { showToast } = useToast();

    const { phase: basePhase, error, connRef, setPhase: setBasePhase, setError } = useVaultConnection();
    const phase = basePhase as Phase;
    const setPhase = setBasePhase as (p: Phase) => void;
    const [pendingPolicy, setPendingPolicy] = useState<'vault:read' | 'vault:write' | null>(null);
    const policyCheck = pendingPolicy && activeConfig ? checkConfigPolicy('user', activeConfig, pendingPolicy) : null;

    const beginInit = (readConfirmed = false, writeConfirmed = false) => {

        if (!activeConfig) {

            setError('No active configuration');

            return;

        }
        for (const permission of ['vault:read', 'vault:write'] as const) {

            const check = checkConfigPolicy('user', activeConfig, permission);
            if (!check.allowed) {

                setError(check.blockedReason ?? `${permission} is not allowed`);

                return;

            }
            if (check.requiresConfirmation && !(permission === 'vault:read' ? readConfirmed : writeConfirmed)) {

                setPendingPolicy(permission);

                return;

            }

        }
        void handleInit();

    };

    // Handle initialization
    const handleInit = useCallback(async () => {

        if (!connRef.current || !identity) return;

        setPhase('initializing');
        setError(null);

        const db = connRef.current.db;
        const connDialect = connRef.current.dialect;

        // Check if already initialized
        const status = await getVaultStatus(db as Kysely<NoormDatabase>, identity.identityHash, connDialect);

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
            connDialect,
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

        if (!isFocused || pendingPolicy) return;

        if (key.escape) {

            back();

            return;

        }

        if (key.return && phase === 'ready') {

            beginInit();

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
    if (pendingPolicy && policyCheck) {

        return (
            <SmartConfirm
                focusLabel="VaultInitPolicyConfirm"
                requiresConfirmation
                confirmationPhrase={policyCheck.confirmationPhrase}
                configName={activeConfigName ?? 'unknown'}
                action={pendingPolicy === 'vault:read' ? 'read vault for' : 'initialize vault for'}
                message={pendingPolicy === 'vault:read' ? 'Read vault status?' : 'Initialize vault?'}
                onConfirm={() => {

                    const permission = pendingPolicy;
                    setPendingPolicy(null);
                    beginInit(true, permission === 'vault:write');

                }}
                onCancel={() => setPendingPolicy(null)}
            />
        );

    }


    // Ready - show confirmation
    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Initialize Vault" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text dimColor>Config: {activeConfigName}</Text>
                    {error && <Text color="red">{error}</Text>}
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
