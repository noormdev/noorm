/**
 * VaultInitScreen - initialize vault for the current database.
 *
 * Generates a new vault key and stores it for the current user.
 */
import { useCallback, useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Kysely } from 'kysely';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope, useBusy } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, SmartConfirm, useToast } from '../../components/index.js';
import { useVaultConnection } from '../../hooks/index.js';
import { checkConfigPolicy } from '../../../core/policy/index.js';
import { initializeVault, getVaultStatus } from '../../../core/vault/index.js';
import { registerIdentity } from '../../../core/identity/sync.js';
import { Hotkey } from '../../components/layout/Hotkey.js';


type Phase = 'connecting' | 'ready' | 'initializing' | 'error';

/**
 * VaultInitScreen component.
 */
export function VaultInitScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('VaultInit');
    const { activeConfig, activeConfigName, identity } = useAppContext();
    const { showToast } = useToast();

    const [connectionApproved, setConnectionApproved] = useState(false);
    const [initializationRequested, setInitializationRequested] = useState(false);
    const { phase: basePhase, error, connRef, setPhase: setBasePhase, setError } = useVaultConnection({ enabled: connectionApproved });
    const phase = (connectionApproved ? basePhase : 'ready') as Phase;

    useBusy(phase === 'initializing');
    const setPhase = setBasePhase as (p: Phase) => void;
    const [pendingPolicy, setPendingPolicy] = useState<'vault:write' | null>(null);
    const policyCheck = pendingPolicy && activeConfig ? checkConfigPolicy('user', activeConfig, pendingPolicy) : null;

    const beginInit = (writeConfirmed = false) => {

        if (!activeConfig) {

            setError('No active configuration');

            return;

        }
        const check = checkConfigPolicy('user', activeConfig, 'vault:write');
        if (!check.allowed) {

            setError(check.blockedReason ?? 'vault:write is not allowed');

            return;

        }
        if (check.requiresConfirmation && !writeConfirmed) {

            setPendingPolicy('vault:write');

            return;

        }
        setConnectionApproved(true);
        setInitializationRequested(true);

    };

    // Handle initialization
    const handleInit = useCallback(async () => {

        if (!connRef.current || !identity) return;

        setPhase('initializing');
        setError(null);

        const db = connRef.current.db;
        const connDialect = connRef.current.dialect;

        let status = await getVaultStatus(db as Kysely<NoormDatabase>, identity.identityHash, connDialect);
        if (!status.isInitialized) {

            const registered = await registerIdentity(db as Kysely<NoormDatabase>, identity, connDialect);
            if (!registered.ok) {

                setError(registered.error ?? 'Failed to register vault identity');
                setPhase('ready');

                return;

            }
            const [vaultKey, initErr] = await initializeVault(
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
            if (vaultKey) {

                showToast({ message: 'Vault initialized successfully', variant: 'success' });
                back();

                return;

            }
            status = await getVaultStatus(db as Kysely<NoormDatabase>, identity.identityHash, connDialect);
            if (!status.isInitialized) {

                setError('Vault initialization did not complete. Try again.');
                setPhase('ready');

                return;

            }

        }
        showToast({
            message: status.hasAccess
                ? 'Vault already initialized'
                : 'Vault initialized but you lack access. Ask a team member.',
            variant: status.hasAccess ? 'info' : 'warning',
        });
        back();

    }, [identity, showToast, back, connRef, setPhase, setError]);

    useEffect(() => {

        if (!initializationRequested || phase !== 'ready' || !connRef.current) return;
        setInitializationRequested(false);
        void handleInit();

    }, [initializationRequested, phase, connRef, handleInit]);

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
                    <Hotkey keys="Esc">Back</Hotkey>
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
                    <Hotkey keys="Esc">Back</Hotkey>
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
                action="initialize vault for"
                message="Initialize vault?"
                onConfirm={() => {

                    setPendingPolicy(null);
                    beginInit(true);

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
                <Hotkey keys="Enter">Initialize</Hotkey>
                <Hotkey keys="Esc">Cancel</Hotkey>
            </Box>
        </Box>
    );

}
