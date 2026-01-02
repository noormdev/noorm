/**
 * ConfigImportScreen - import configuration from encrypted file.
 *
 * Decrypts config with local private key and prompts for database credentials.
 *
 * @example
 * ```bash
 * noorm config:import staging.noorm.enc   # Import from file
 * noorm config import staging.noorm.enc   # Same thing
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { attempt, attemptSync } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { FormValues, FormField } from '../../components/index.js';
import type { Config } from '../../../core/config/types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import {
    Panel,
    Form,
    Spinner,
    StatusMessage,
    SelectList,
    type SelectListItem,
} from '../../components/index.js';
import { decryptWithPrivateKey } from '../../../core/identity/crypto.js';
import { loadPrivateKey } from '../../../core/identity/storage.js';
import type { SharedConfigPayload } from '../../../core/identity/types.js';

/**
 * Import steps.
 */
type ImportStep =
    | 'file-select' // Select file to import
    | 'decrypting' // Decrypting file
    | 'preview' // Show preview and get credentials
    | 'saving' // Saving config
    | 'complete' // Success
    | 'error'; // Error occurred

/**
 * Imported config data structure.
 */
interface ImportedData {
    config: Partial<Config>;
    secrets: Record<string, string>;
}

/**
 * ConfigImportScreen component.
 */
export function ConfigImportScreen({ params }: ScreenProps): ReactElement {

    const { navigate: _navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ConfigImport');
    const { stateManager, configs, refresh } = useAppContext();

    const filePath = params.path;

    const [step, setStep] = useState<ImportStep>(filePath ? 'decrypting' : 'file-select');
    const [_selectedFile, setSelectedFile] = useState(filePath ?? '');
    const [importedData, setImportedData] = useState<ImportedData | null>(null);
    const [senderEmail, setSenderEmail] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [savedName, setSavedName] = useState('');

    // Check if config name exists
    const nameExists = useCallback(
        (name: string) => {

            return configs.some((c) => c.name === name);

        },
        [configs],
    );

    // Handle file selection
    const handleFileSelect = useCallback(async (path: string) => {

        setSelectedFile(path);
        await decryptFile(path);

    }, []);

    // Decrypt the file
    const decryptFile = useCallback(async (path: string) => {

        setStep('decrypting');

        const [_, err] = await attempt(async () => {

            if (!existsSync(path)) {

                throw new Error(`File not found: ${path}`);

            }

            const content = readFileSync(path, 'utf8');
            const payload = JSON.parse(content) as SharedConfigPayload;

            setSenderEmail(payload.sender);

            const privateKey = await loadPrivateKey();

            if (!privateKey) {

                throw new Error('No private key found. Run "noorm init" first.');

            }

            const decrypted = decryptWithPrivateKey(payload, privateKey);
            const data = JSON.parse(decrypted) as ImportedData;

            setImportedData(data);

        });

        if (err) {

            setError(err instanceof Error ? err.message : String(err));
            setStep('error');

            return;

        }

        setStep('preview');

    }, []);

    // Auto-decrypt if file path provided
    useMemo(() => {

        if (filePath && step === 'decrypting') {

            decryptFile(filePath);

        }

    }, [filePath]);

    // Handle form submission with credentials
    const handleCredentialsSubmit = useCallback(
        async (values: FormValues) => {

            if (!stateManager || !importedData) {

                setError('Import data not available');
                setStep('error');

                return;

            }

            setStep('saving');

            const [_, err] = await attempt(async () => {

                const configName = String(values['name'] || importedData.config.name);

                // Build full config with credentials
                const config: Config = {
                    name: configName,
                    type: importedData.config.type ?? 'local',
                    isTest: importedData.config.isTest ?? false,
                    protected: importedData.config.protected ?? false,
                    connection: {
                        dialect: importedData.config.connection?.dialect ?? 'postgres',
                        host: importedData.config.connection?.host,
                        port: importedData.config.connection?.port,
                        database: importedData.config.connection?.database ?? '',
                        user: values['user'] ? String(values['user']) : undefined,
                        password: values['password'] ? String(values['password']) : undefined,
                        ssl: importedData.config.connection?.ssl,
                    },
                    paths: {
                        sql: importedData.config.paths?.sql ?? './sql',
                        changes: importedData.config.paths?.changes ?? './changes',
                    },
                };

                // Save config
                await stateManager.setConfig(configName, config);

                // Import secrets
                for (const [key, value] of Object.entries(importedData.secrets)) {

                    await stateManager.setSecret(configName, key, value);

                }

                await refresh();
                setSavedName(configName);

            });

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setStep('error');

                return;

            }

            setStep('complete');

        },
        [stateManager, importedData, refresh],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (step === 'complete' || step === 'error') {

            back();

        }

        if (step === 'file-select' && key.escape) {

            back();

        }

    });

    // Find .noorm.enc files in current directory
    const encFiles = useMemo(() => {

        const [files, err] = attemptSync(() => readdirSync(process.cwd()));

        if (err) {

            return [];

        }

        return files.filter((f) => f.endsWith('.noorm.enc'));

    }, []);

    // File items for SelectList
    const fileItems: SelectListItem<string>[] = encFiles.map((file) => ({
        key: file,
        label: file,
        value: file,
    }));

    // Handle file selection from list
    const handleFileListSelect = useCallback(
        (item: SelectListItem<string>) => {

            handleFileSelect(join(process.cwd(), item.value));

        },
        [handleFileSelect],
    );

    // File picker
    if (step === 'file-select') {

        if (encFiles.length === 0) {

            return (
                <Panel title="Import Configuration" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">No .noorm.enc files found in current directory.</Text>
                        <Text dimColor>Use: noorm config:import &lt;file&gt;</Text>
                        <Box marginTop={1}>
                            <Text dimColor>[Esc] Go back</Text>
                        </Box>
                    </Box>
                </Panel>
            );

        }

        return (
            <Panel title="Import Configuration" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>Select a file to import:</Text>
                    <SelectList
                        items={fileItems}
                        onSelect={handleFileListSelect}
                        focusLabel="ConfigImportFile"
                    />
                </Box>
            </Panel>
        );

    }

    // Decrypting
    if (step === 'decrypting') {

        return (
            <Panel title="Import Configuration" paddingX={2} paddingY={1}>
                <Spinner label="Decrypting file..." />
            </Panel>
        );

    }

    // Preview and credentials form
    if (step === 'preview' && importedData) {

        const suggestedName = importedData.config.name ?? 'imported';
        const needsRename = nameExists(suggestedName);

        const fields: FormField[] = [
            {
                key: 'name',
                label: needsRename ? 'Config Name (rename required)' : 'Config Name',
                type: 'text',
                required: true,
                defaultValue: needsRename ? `${suggestedName}-imported` : suggestedName,
                validate: (value) => {

                    if (typeof value !== 'string' || !value) return 'Name is required';

                    if (!/^[a-z0-9_-]+$/i.test(value)) {

                        return 'Only letters, numbers, hyphens, underscores';

                    }

                    if (nameExists(value)) {

                        return 'Config name already exists';

                    }

                    return undefined;

                },
            },
            {
                key: 'user',
                label: 'Database User',
                type: 'text',
                required: true,
                placeholder: 'postgres',
            },
            {
                key: 'password',
                label: 'Database Password',
                type: 'password',
                placeholder: '(required)',
            },
        ];

        const secretCount = Object.keys(importedData.secrets).length;

        return (
            <Panel title="Import Configuration" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Box flexDirection="column">
                        <Text>
                            From: <Text color="cyan">{senderEmail}</Text>
                        </Text>
                        <Text>
                            Dialect:{' '}
                            <Text color="cyan">{importedData.config.connection?.dialect}</Text>
                        </Text>
                        <Text>
                            Database:{' '}
                            <Text color="cyan">{importedData.config.connection?.database}</Text>
                        </Text>
                        <Text>
                            Host:{' '}
                            <Text color="cyan">
                                {importedData.config.connection?.host}:
                                {importedData.config.connection?.port}
                            </Text>
                        </Text>
                        <Text>
                            Secrets: <Text color="cyan">{secretCount} included</Text>
                        </Text>
                    </Box>

                    <Box marginTop={1}>
                        <Text bold>Enter your database credentials:</Text>
                    </Box>

                    <Form
                        fields={fields}
                        onSubmit={handleCredentialsSubmit}
                        onCancel={handleCancel}
                        submitLabel="Import"
                        focusLabel="ConfigImportForm"
                    />
                </Box>
            </Panel>
        );

    }

    // Saving
    if (step === 'saving') {

        return (
            <Panel title="Import Configuration" paddingX={2} paddingY={1}>
                <Spinner label="Saving configuration..." />
            </Panel>
        );

    }

    // Complete
    if (step === 'complete') {

        return (
            <Panel title="Import Configuration" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Configuration "{savedName}" imported successfully!
                    </StatusMessage>
                    <Box marginTop={1}>
                        <Text dimColor>Press any key to continue...</Text>
                    </Box>
                </Box>
            </Panel>
        );

    }

    // Error
    return (
        <Panel title="Import Configuration" paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">{error}</StatusMessage>
                <Box marginTop={1}>
                    <Text dimColor>Press any key to continue...</Text>
                </Box>
            </Box>
        </Panel>
    );

}
