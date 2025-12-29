/**
 * ChangeAddScreen - create a new changeset folder.
 *
 * Prompts for changeset name and creates folder structure:
 * - changesets/{date}-{name}/
 *   - change/001_change.sql
 *   - revert/001_revert.sql
 *   - changelog.md
 *
 * @example
 * ```bash
 * noorm change:add add-user-roles    # Create changeset
 * noorm change add add-user-roles    # Same thing
 * ```
 */
import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { attempt } from '@logosdx/utils';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, StatusMessage } from '../../components/index.js';
import { createChangeset, addFile } from '../../../core/changeset/scaffold.js';

/**
 * Add steps.
 */
type AddStep =
    | 'input' // Entering name
    | 'creating' // Creating folder structure
    | 'complete' // Success
    | 'error'; // Error occurred

/**
 * ChangeAddScreen component.
 */
export function ChangeAddScreen({ params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ChangeAdd');
    const { activeConfig, settings: _settings } = useAppContext();

    // Pre-fill from params if provided
    const initialName = params.name ?? '';

    const [step, setStep] = useState<AddStep>(initialName ? 'creating' : 'input');
    const [name, setName] = useState(initialName);
    const [createdName, setCreatedName] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Validate name
    const validateName = useCallback((value: string): string | null => {

        if (!value.trim()) {

            return 'Name is required';

        }

        if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/i.test(value.trim())) {

            return 'Use letters, numbers, and hyphens only';

        }

        return null;

    }, []);

    // Handle create
    const handleCreate = useCallback(
        async (nameValue: string) => {

            if (!activeConfig) {

                setError('No active configuration');
                setStep('error');

                return;

            }

            const validationError = validateName(nameValue);

            if (validationError) {

                setError(validationError);
                setStep('error');

                return;

            }

            setStep('creating');

            const [_, err] = await attempt(async () => {

                // Create changeset folder
                const changeset = await createChangeset(activeConfig.paths.changesets, {
                    description: nameValue.trim(),
                });

                // Add initial files
                await addFile(changeset, 'change', {
                    name: 'change',
                    type: 'sql',
                });

                await addFile(changeset, 'revert', {
                    name: 'revert',
                    type: 'sql',
                });

                setCreatedName(changeset.name);
                setStep('complete');

            });

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setStep('error');

            }

        },
        [activeConfig, validateName],
    );

    // Auto-create if name provided in params
    if (initialName && step === 'creating' && !createdName && !error) {

        handleCreate(initialName);

    }

    // Handle submit
    const handleSubmit = useCallback(() => {

        handleCreate(name);

    }, [name, handleCreate]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (step === 'input') {

            if (key.return) {

                handleSubmit();

                return;

            }

            if (key.escape) {

                if (name) {

                    setName('');

                }
                else {

                    back();

                }

                return;

            }

        }

        if (step === 'complete') {

            if (input === 'e') {

                navigate('change/edit', { name: createdName });

            }
            else {

                back();

            }

            return;

        }

        if (step === 'error') {

            if (input === 'r') {

                setError(null);
                setStep('input');

            }
            else {

                back();

            }

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Add Changeset" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration. Press 'c' to manage configs.</Text>
            </Panel>
        );

    }

    // Input step
    if (step === 'input') {

        return (
            <Panel title="Add Changeset" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>Create a new changeset for database changes.</Text>
                    <Text dimColor>
                        Folder will be created as: {new Date().toISOString().slice(0, 10)}-
                        {name || '<name>'}
                    </Text>

                    <Box marginTop={1}>
                        <Text>Name: </Text>
                        <TextInput
                            placeholder="add-user-roles"
                            defaultValue={name}
                            onChange={setName}
                            isDisabled={!isFocused}
                        />
                    </Box>

                    <Box marginTop={1} gap={2}>
                        <Text dimColor>[Enter] Create</Text>
                        <Text dimColor>[Esc] Cancel</Text>
                    </Box>
                </Box>
            </Panel>
        );

    }

    // Creating step
    if (step === 'creating') {

        return (
            <Panel title="Add Changeset" paddingX={2} paddingY={1}>
                <Spinner label="Creating changeset folder..." />
            </Panel>
        );

    }

    // Complete step
    if (step === 'complete') {

        return (
            <Panel title="Add Changeset" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Changeset "{createdName}" created!
                    </StatusMessage>

                    <Text dimColor>Created folder structure with template files.</Text>

                    <Box marginTop={1} gap={2}>
                        <Text dimColor>[e] Edit in editor</Text>
                        <Text dimColor>[any] Back to list</Text>
                    </Box>
                </Box>
            </Panel>
        );

    }

    // Error step
    return (
        <Panel title="Add Changeset" paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">{error}</StatusMessage>

                <Box marginTop={1} gap={2}>
                    <Text dimColor>[r] Retry</Text>
                    <Text dimColor>[any] Back</Text>
                </Box>
            </Box>
        </Panel>
    );

}
