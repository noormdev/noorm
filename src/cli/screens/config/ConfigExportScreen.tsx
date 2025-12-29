/**
 * ConfigExportScreen - export configuration for sharing.
 *
 * Encrypts config + secrets with recipient's public key.
 * Does NOT include user/password (recipient uses their own).
 *
 * @example
 * ```bash
 * noorm config:export dev     # Export 'dev' config
 * noorm config export dev     # Same thing
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { attempt } from '@logosdx/utils';

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
    type SelectListItem,
} from '../../components/index.js';
import { encryptForRecipient } from '../../../core/identity/crypto.js';
import type { KnownUser } from '../../../core/identity/types.js';

/**
 * Export steps.
 */
type ExportStep =
    | 'recipient-email' // Enter recipient email
    | 'select-identity' // Pick identity if multiple match
    | 'exporting' // Encrypting and writing file
    | 'complete' // Success
    | 'error'; // Error occurred

/**
 * ConfigExportScreen component.
 */
export function ConfigExportScreen({ params }: ScreenProps): ReactElement {

    const { navigate: _navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ConfigExport');
    const { stateManager, identity } = useAppContext();

    const configName = params.name;

    const [step, setStep] = useState<ExportStep>('recipient-email');
    const [email, setEmail] = useState('');
    const [matchingUsers, setMatchingUsers] = useState<KnownUser[]>([]);
    const [selectedUser, setSelectedUser] = useState<KnownUser | null>(null);
    const [outputFile, setOutputFile] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Get the config
    const config = useMemo(() => {

        if (!stateManager || !configName) return null;

        return stateManager.getConfig(configName);

    }, [stateManager, configName]);

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

    }, [stateManager, email]);

    // Handle identity selection
    const handleSelectIdentity = useCallback((item: SelectListItem<KnownUser>) => {

        setSelectedUser(item.value);
        handleExport(item.value);

    }, []);

    // Handle export
    const handleExport = useCallback(
        async (recipient: KnownUser) => {

            if (!stateManager || !config || !identity || !configName) {

                setError('Missing required data');
                setStep('error');

                return;

            }

            setStep('exporting');

            const [_, err] = await attempt(async () => {

                // Build export data (omit user/password)
                const exportData = {
                    config: {
                        name: config.name,
                        type: config.type,
                        isTest: config.isTest,
                        protected: config.protected,
                        connection: {
                            dialect: config.connection.dialect,
                            host: config.connection.host,
                            port: config.connection.port,
                            database: config.connection.database,
                            ssl: config.connection.ssl,
                            // NO user/password - recipient uses their own
                        },
                        paths: config.paths,
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

                setError(err instanceof Error ? err.message : String(err));
                setStep('error');

                return;

            }

            setStep('complete');

        },
        [stateManager, config, identity, configName],
    );

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

    // Recipient email input
    if (step === 'recipient-email') {

        return (
            <Panel title={`Export: ${configName}`} paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>Export configuration for sharing with another user.</Text>
                    <Text dimColor>Note: Database user/password will NOT be included.</Text>

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
