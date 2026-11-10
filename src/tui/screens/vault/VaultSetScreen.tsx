/**
 * VaultSetScreen - create or update a vault secret.
 *
 * If a secret key is provided via params, edits that secret.
 * Otherwise shows a form to create a new secret.
 */
import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, SmartConfirm, useToast, TextInput } from '../../components/index.js';
import { useVaultConnection } from '../../hooks/index.js';
import { loadPrivateKey } from '../../../core/identity/storage.js';
import { checkConfigPolicy } from '../../../core/policy/index.js';
import { vaultEditConfirmation, vaultEditRefusal, VaultEditRefused, type VaultEditPermission } from './edit-policy.js';
import { getVaultKey, setVaultSecret } from '../../../core/vault/index.js';


type Phase = 'connecting' | 'ready' | 'saving' | 'error';
type FormField = 'key' | 'value';

/**
 * VaultSetScreen component.
 */
export function VaultSetScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('VaultSet');
    const { activeConfig, activeConfigName, identity } = useAppContext();
    const { showToast } = useToast();

    const denied = vaultEditRefusal(activeConfig);

    const { phase: basePhase, error, connRef, setPhase: setBasePhase, setError } = useVaultConnection({ enabled: !denied });
    const phase = basePhase as Phase;
    const setPhase = setBasePhase as (p: Phase) => void;

    const [keyValue, setKeyValue] = useState(params.name ?? '');
    const [secretValue, setSecretValue] = useState('');
    const [activeField, setActiveField] = useState<FormField>(params.name ? 'value' : 'key');
    const [pendingPolicy, setPendingPolicy] = useState<VaultEditPermission | null>(null);
    const policyCheck = pendingPolicy && activeConfig ? checkConfigPolicy('user', activeConfig, pendingPolicy) : null;

    const beginSubmit = (readConfirmed = false, writeConfirmed = false) => {

        if (!activeConfig) {

            setError('No active configuration');

            return;

        }

        const unconfirmed = vaultEditConfirmation(activeConfig, { 'vault:read': readConfirmed, 'vault:write': writeConfirmed });

        if (unconfirmed) {

            setPendingPolicy(unconfirmed);

            return;

        }

        void handleSubmit();

    };

    const isEditing = !!params.name;

    // Handle form submission
    const handleSubmit = useCallback(async () => {

        if (!connRef.current || !identity) {

            setError('Not connected to database');

            return;

        }

        if (!keyValue.trim()) {

            setError('Secret key is required');

            return;

        }

        if (!secretValue.trim()) {

            setError('Secret value is required');

            return;

        }

        setPhase('saving');
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

        const [, err] = await attempt(async () => {

            const [, setErr] = await setVaultSecret(
                db as Kysely<NoormDatabase>,
                vaultKey,
                keyValue.trim(),
                secretValue,
                identity.email,
                connDialect,
            );

            if (setErr) throw setErr;

        });

        if (err) {

            setError(err.message);
            setPhase('ready');

            return;

        }

        showToast({
            message: `Vault secret "${keyValue}" saved`,
            variant: 'success',
        });
        back();

    }, [identity, keyValue, secretValue, showToast, back, connRef, setPhase, setError]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (denied) {

            if (key.escape) back();

            return;

        }

        if (phase !== 'ready' || pendingPolicy) return;

        if (key.escape) {

            back();

            return;

        }

        if (key.tab || (key.return && activeField === 'key' && keyValue.trim())) {

            // Move to next field
            if (activeField === 'key') {

                setActiveField('value');

            }
            else if (activeField === 'value' && secretValue.trim()) {

                beginSubmit();

            }

            return;

        }

        if (key.return && activeField === 'value' && secretValue.trim()) {

            beginSubmit();

        }

    });

    if (denied) return <VaultEditRefused title="Set Vault Secret" reason={denied.blockedReason} />;

    // No identity
    if (!identity) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Set Vault Secret" paddingX={2} paddingY={1} borderColor="red">
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
                <Panel title="Set Vault Secret" paddingX={2} paddingY={1}>
                    <Spinner label="Connecting..." />
                </Panel>
            </Box>
        );

    }

    // Error (fatal)
    if (phase === 'error' && !connRef.current) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Set Vault Secret" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">{error}</Text>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Saving
    if (phase === 'saving') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Set Vault Secret" paddingX={2} paddingY={1}>
                    <Spinner label="Saving..." />
                </Panel>
            </Box>
        );

    }
    if (pendingPolicy && policyCheck) {

        return (
            <SmartConfirm
                focusLabel="VaultSetPolicyConfirm"
                requiresConfirmation
                confirmationPhrase={policyCheck.confirmationPhrase}
                configName={activeConfigName ?? 'unknown'}
                action={pendingPolicy === 'vault:read' ? 'read vault for' : 'write vault for'}
                message={pendingPolicy === 'vault:read' ? 'Read vault key?' : 'Save vault secret?'}
                onConfirm={() => {

                    const permission = pendingPolicy;
                    setPendingPolicy(null);
                    beginSubmit(true, permission === 'vault:write');

                }}
                onCancel={() => setPendingPolicy(null)}
            />
        );

    }


    const title = isEditing ? `Update Vault Secret: ${params.name}` : 'Add Vault Secret';

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={title} paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text dimColor>Config: {activeConfigName}</Text>

                    {/* Key field */}
                    <Box gap={1}>
                        <Text>Key:</Text>
                        {isEditing ? (
                            <Text>{keyValue}</Text>
                        ) : (
                            <TextInput
                                defaultValue={keyValue}
                                onChange={setKeyValue}
                                placeholder="SECRET_NAME"
                                isDisabled={activeField !== 'key'}
                            />
                        )}
                    </Box>

                    {/* Value field */}
                    <Box gap={1}>
                        <Text>Value:</Text>
                        <TextInput
                            defaultValue={secretValue}
                            onChange={setSecretValue}
                            placeholder="secret value"
                            isDisabled={activeField !== 'value'}
                        />
                    </Box>

                    {/* Error */}
                    {error && (
                        <Text color="red">{error}</Text>
                    )}
                </Box>
            </Panel>

            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[Tab] Next Field</Text>
                <Text dimColor>[Enter] Save</Text>
                <Text dimColor>[Esc] Cancel</Text>
            </Box>
        </Box>
    );

}
