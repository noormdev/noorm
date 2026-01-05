/**
 * ChangeAddScreen - create a new change folder.
 *
 * Prompts for a description and creates folder structure:
 * - changes/{date}-{kebab-cased-description}/
 *   - change/001_change.sql
 *   - revert/001_revert.sql
 *   - changelog.md
 *
 * The description is automatically converted to kebab-case:
 * - "Add user roles table" -> "add-user-roles-table"
 * - "Fix the bug!" -> "fix-the-bug"
 *
 * @example
 * ```bash
 * noorm change:add "Add user roles"    # Create change
 * noorm change add "Add user roles"    # Same thing
 * ```
 */
import { useState, useCallback } from 'react';
import { existsSync } from 'fs';
import { join } from 'path';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { attempt } from '@logosdx/utils';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, StatusMessage } from '../../components/index.js';
import { createChange, addFile } from '../../../core/change/scaffold.js';
import { toKebabCase } from '../../utils/index.js';

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

    // Convert input to kebab-case for preview
    const kebabName = toKebabCase(name);

    // Validate name - just check it's not empty after conversion
    const validateName = useCallback((value: string): string | null => {

        const converted = toKebabCase(value);

        if (!converted) {

            return 'Description is required';

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

            // Convert to kebab-case
            const kebabDescription = toKebabCase(nameValue);

            // Check for duplicate folder name
            const datePrefix = new Date().toISOString().slice(0, 10);
            const expectedFolder = `${datePrefix}-${kebabDescription}`;
            const folderPath = join(activeConfig.paths.changes, expectedFolder);

            if (existsSync(folderPath)) {

                setError(`Change "${expectedFolder}" already exists`);
                setStep('error');

                return;

            }

            setStep('creating');

            const [_, err] = await attempt(async () => {

                // Create change folder
                const change = await createChange(activeConfig.paths.changes, {
                    description: kebabDescription,
                });

                // Add initial files
                await addFile(change, 'change', {
                    name: 'change',
                    type: 'sql',
                });

                await addFile(change, 'revert', {
                    name: 'revert',
                    type: 'sql',
                });

                setCreatedName(change.name);
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
            <Panel title="Add Change" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration. Press 'c' to manage configs.</Text>
            </Panel>
        );

    }

    // Input step
    if (step === 'input') {

        return (
            <Panel title="Add Change" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>Describe the change you want to make:</Text>

                    <Box marginTop={1}>
                        <Text>Description: </Text>
                        <TextInput
                            placeholder="Add user roles table"
                            defaultValue={name}
                            onChange={setName}
                            isDisabled={!isFocused}
                        />
                    </Box>

                    {kebabName && (
                        <Text dimColor>
                            Folder: {new Date().toISOString().slice(0, 10)}-{kebabName}
                        </Text>
                    )}

                    <Box marginTop={1} flexWrap="wrap" columnGap={2}>
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
            <Panel title="Add Change" paddingX={2} paddingY={1}>
                <Spinner label="Creating change folder..." />
            </Panel>
        );

    }

    // Complete step
    if (step === 'complete') {

        return (
            <Panel title="Add Change" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Change "{createdName}" created!
                    </StatusMessage>

                    <Text dimColor>Created folder structure with template files.</Text>

                    <Box marginTop={1} flexWrap="wrap" columnGap={2}>
                        <Text dimColor>[e] Edit in editor</Text>
                        <Text dimColor>[any] Back to list</Text>
                    </Box>
                </Box>
            </Panel>
        );

    }

    // Error step
    return (
        <Panel title="Add Change" paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">{error}</StatusMessage>

                <Box marginTop={1} flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[r] Retry</Text>
                    <Text dimColor>[any] Back</Text>
                </Box>
            </Box>
        </Panel>
    );

}
