/**
 * ConfigExportScreen - export configuration for sharing.
 *
 * Encrypts config + secrets with recipient's public key.
 * Does NOT include user/password or an inline client key and certificate
 * (recipient uses their own).
 *
 * @example
 * ```bash
 * noorm config:export dev     # Export 'dev' config
 * noorm config export dev     # Same thing
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { attempt, attemptSync } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import {
    Panel,
    Spinner,
    StatusMessage,
    SelectList,
    TextInput,
    ProtectedConfirm,
    type SelectListItem,
} from '../../components/index.js';
import { encryptForRecipient } from '../../../core/identity/crypto.js';
import type { KnownUser } from '../../../core/identity/types.js';
import type { ConnectionConfig } from '../../../core/connection/types.js';
import { checkConfigPolicy, confirmationPhraseFor, getPolicyFingerprint, guarded } from '../../../core/policy/index.js';
import { SettingsProvider, effectiveConfig } from '../../../core/config/resolver.js';
import { getErrorMessage } from '../../utils/index.js';

/**
 * Export steps.
 */
type ExportStep =
    | 'recipient-email' // Enter recipient email
    | 'select-identity' // Pick identity if multiple match
    | 'confirm' // Review export of configuration and secrets
    | 'exporting' // Encrypting and writing file
    | 'complete' // Success
    | 'error'; // Error occurred

// Removes the credentials and keeps the rest, so a connection field added later travels without an edit here.
function withoutCredentials(connection: ConnectionConfig): ConnectionConfig {

    const { user: _user, password: _password, ...shared } = connection;

    if (typeof shared.ssl !== 'object') return shared;

    const { key: _key, cert: _cert, ...ssl } = shared.ssl;

    return { ...shared, ssl: Object.keys(ssl).length > 0 ? ssl : true };

}

/**
 * ConfigExportScreen component.
 */
export function ConfigExportScreen({ params }: ScreenProps): ReactElement {

    const { navigate: _navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ConfigExport');
    const { stateManager, settingsManager, identity } = useAppContext();

    const configName = params.name;

    const [step, setStep] = useState<ExportStep>('recipient-email');
    const [email, setEmail] = useState('');
    const [matchingUsers, setMatchingUsers] = useState<KnownUser[]>([]);
    const [selectedUser, setSelectedUser] = useState<KnownUser | null>(null);
    const [outputFile, setOutputFile] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pendingExport, setPendingExport] = useState<{
        recipient: KnownUser;
        fingerprint: string;
        phrase: string;
    } | null>(null);

    // Get the config
    const config = useMemo(() => {

        if (!stateManager || !configName) return null;

        return stateManager.getConfig(configName);

    }, [stateManager, configName]);

    // Handle export
    const handleExport = useCallback(
        async (recipient: KnownUser, approvedFingerprint?: string) => {

            if (!stateManager || !config || !identity || !configName) {

                setError('Missing required data');
                setStep('error');

                return;

            }
            const [policyConfig, policyError] = attemptSync(() => {

                if (!settingsManager) throw new Error('Settings are not available');

                return effectiveConfig(config, new SettingsProvider(settingsManager));

            });
            if (policyError) {

                setError(policyError.message);
                setStep('error');

                return;

            }
            const check = checkConfigPolicy('user', policyConfig, 'secret:read');
            if (!check.allowed) {

                setError(check.blockedReason ?? 'Config cannot be exported');
                setStep('error');

                return;

            }
            const fingerprint = getPolicyFingerprint(policyConfig);
            if (check.requiresConfirmation && approvedFingerprint !== fingerprint) {

                setPendingExport({
                    recipient,
                    fingerprint,
                    phrase: check.confirmationPhrase ?? confirmationPhraseFor(config.name),
                });
                setStep('confirm');

                return;

            }

            setStep('exporting');

            const [_, err] = await attempt(async () => {


                // `access` is the source of truth; `protected` rides along so
                // an as-yet-unupgraded importer on the recipient's end still
                // gets a safe (if coarser) access decision.
                const exportData = {
                    config: {
                        name: config.name,
                        type: config.type,
                        isTest: config.isTest,
                        access: config.access,
                        protected: guarded(policyConfig),
                        connection: withoutCredentials(config.connection),
                    },
                    secrets: stateManager.getAllSecrets(configName),
                };

                // Encrypt for recipient
                const payload = encryptForRecipient(
                    JSON.stringify(exportData),
                    recipient.publicKey,
                    identity.email,
                    recipient.email,
                );

                // Write to file
                const filename = `${configName}.noorm.enc`;
                const filepath = join(process.cwd(), filename);
                writeFileSync(filepath, JSON.stringify(payload, null, 2));

                setOutputFile(filename);

            });

            if (err) {

                setError(getErrorMessage(err));
                setStep('error');

                return;

            }

            setStep('complete');

        },
        [stateManager, settingsManager, config, identity, configName],
    );

    // Handle email submission
    const handleEmailSubmit = useCallback(() => {

        if (!stateManager || !email) return;

        // Find known users with this email
        const users = stateManager.findKnownUsersByEmail(email);

        if (users.length === 0) {

            setError(`No known users with email "${email}". Import their identity first.`);
            setStep('error');

            return;

        }

        if (users.length === 1) {

            setSelectedUser(users[0]!);
            handleExport(users[0]!);

        }
        else {

            setMatchingUsers(users);
            setStep('select-identity');

        }

    }, [stateManager, email, handleExport]);

    // Handle identity selection
    const handleSelectIdentity = useCallback((item: SelectListItem<KnownUser>) => {

        setSelectedUser(item.value);
        handleExport(item.value);

    }, [handleExport]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (step === 'recipient-email') {

            if (key.return) {

                handleEmailSubmit();

                return;

            }

            if (key.escape) {

                if (email) {

                    setEmail('');

                }
                else {

                    back();

                }

                return;

            }

        }

        if (step === 'complete' || step === 'error') {

            back();

        }

    });

    // No config name provided
    if (!configName) {

        return (
            <Panel title="Export Configuration" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">
                    No config name provided. Use: noorm config:export &lt;name&gt;
                </Text>
            </Panel>
        );

    }

    // Config not found
    if (!config) {

        return (
            <Panel title="Export Configuration" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">Config "{configName}" not found.</Text>
            </Panel>
        );

    }

    // No identity set up
    if (!identity) {

        return (
            <Panel title="Export Configuration" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No identity set up. Run 'noorm init' first.</Text>
            </Panel>
        );

    }
    if (step === 'confirm' && pendingExport) {

        return (
            <ProtectedConfirm
                configName={configName}
                confirmPhrase={pendingExport.phrase}
                action={`export configuration and secrets to ${pendingExport.recipient.email}`}
                onConfirm={() => {

                    void handleExport(pendingExport.recipient, pendingExport.fingerprint);

                }}
                onCancel={back}
                isFocused={isFocused}
            />
        );

    }


    // Recipient email input
    if (step === 'recipient-email') {

        return (
            <Panel title={`Export: ${configName}`} paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>Export configuration for sharing with another user.</Text>
                    <Text dimColor>Note: Database user/password and inline client key/certificate will NOT be included.</Text>

                    <Box marginTop={1}>
                        <Text>Recipient email: </Text>
                        <TextInput
                            placeholder="alice@example.com"
                            defaultValue={email}
                            onChange={setEmail}
                            isDisabled={!isFocused}
                        />
                    </Box>

                    <Box marginTop={1} gap={2}>
                        <Text dimColor>[Enter] Continue</Text>
                        <Text dimColor>[Esc] Cancel</Text>
                    </Box>
                </Box>
            </Panel>
        );

    }

    // Select identity
    if (step === 'select-identity') {

        const items: SelectListItem<KnownUser>[] = matchingUsers.map((user) => ({
            key: user.identityHash,
            label: `${user.machine} (${user.os})`,
            value: user,
            description: `Last seen: ${user.lastSeen ?? 'unknown'}`,
        }));

        return (
            <Panel title={`Export: ${configName}`} paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>Multiple identities found for {email}:</Text>

                    <Box marginTop={1}>
                        <SelectList
                            items={items}
                            onSelect={handleSelectIdentity}
                            focusLabel="ConfigExportIdentity"
                        />
                    </Box>
                </Box>
            </Panel>
        );

    }

    // Exporting
    if (step === 'exporting') {

        return (
            <Panel title={`Export: ${configName}`} paddingX={2} paddingY={1}>
                <Spinner label="Encrypting and exporting..." />
            </Panel>
        );

    }

    // Complete
    if (step === 'complete') {

        return (
            <Panel title={`Export: ${configName}`} paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Configuration exported successfully!
                    </StatusMessage>
                    <Text>
                        File: <Text color="cyan">{outputFile}</Text>
                    </Text>
                    <Text dimColor>
                        Share this file with {selectedUser?.email ?? email}. They can import it
                        with: noorm config:import {outputFile}
                    </Text>
                    <Box marginTop={1}>
                        <Text dimColor>Press any key to continue...</Text>
                    </Box>
                </Box>
            </Panel>
        );

    }

    // Error
    return (
        <Panel title={`Export: ${configName}`} paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">{error}</StatusMessage>
                <Box marginTop={1}>
                    <Text dimColor>Press any key to continue...</Text>
                </Box>
            </Box>
        </Panel>
    );

}
