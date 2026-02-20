/**
 * ConfigCopyScreen - clone a configuration with a new name.
 *
 * Copies all settings from the source config to a new config.
 *
 * @example
 * ```bash
 * noorm config:cp dev      # Copy 'dev' config
 * noorm config cp dev      # Same thing
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, useToast, MissingParamPanel, NotFoundPanel } from '../../components/index.js';
import { getErrorMessage, validateConfigName } from '../../utils/index.js';

/**
 * ConfigCopyScreen component.
 */
export function ConfigCopyScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('ConfigCopy');
    const { stateManager, configs, refresh } = useAppContext();
    const { showToast } = useToast();

    const configName = params.name;

    const [copying, setCopying] = useState(false);
    const [newName, setNewName] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);

    // Get the source config
    const config = useMemo(() => {

        if (!stateManager || !configName) return null;

        return stateManager.getConfig(configName);

    }, [stateManager, configName]);

    // Handle name change
    const handleNameChange = useCallback((value: string) => {

        setNewName(value);
        setValidationError(null);

    }, []);

    // Handle submit
    const handleSubmit = useCallback(async () => {

        if (!stateManager || !config || !configName) {

            showToast({ message: 'Config not found', variant: 'error' });
            back();

            return;

        }

        const validationErr = validateConfigName(newName, configs.map((c) => c.name));

        if (validationErr) {

            setValidationError(validationErr);

            return;

        }

        setCopying(true);

        const [_, err] = await attempt(async () => {

            // Create copy with new name
            const newConfig = {
                ...config,
                name: newName,
            };

            await stateManager.setConfig(newName, newConfig);
            await refresh();

        });

        if (err) {

            showToast({
                message: getErrorMessage(err),
                variant: 'error',
            });
            setCopying(false);

            return;

        }

        // Success - show toast and go back (pops history)
        showToast({
            message: `Configuration copied to "${newName}"`,
            variant: 'success',
        });
        back();

    }, [stateManager, config, configName, newName, configs, refresh, showToast, back]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused || copying) return;

        if (key.return) {

            handleSubmit();

            return;

        }

        if (key.escape) {

            if (newName) {

                setNewName('');

            }
            else {

                handleCancel();

            }

        }

    });

    // No config name provided
    if (!configName) {

        return <MissingParamPanel title="Copy Configuration" param="config name" usage="noorm config:cp <name>" />;

    }

    // Config not found
    if (!config) {

        return <NotFoundPanel title="Copy Configuration" type="Config" name={configName} />;

    }

    // Copying
    if (copying) {

        return (
            <Panel title={`Copy: ${configName}`} paddingX={2} paddingY={1}>
                <Spinner label="Copying configuration..." />
            </Panel>
        );

    }

    // Input step
    return (
        <Panel title={`Copy: ${configName}`} paddingX={2} paddingY={1}>
            <Box flexDirection="column" gap={1}>
                <Text>
                    Create a copy of <Text color="cyan">{configName}</Text>
                </Text>

                <Box marginTop={1}>
                    <Text>New name: </Text>
                    <TextInput
                        placeholder={`${configName}-copy`}
                        defaultValue={newName}
                        onChange={handleNameChange}
                        isDisabled={!isFocused}
                    />
                </Box>

                {validationError && <Text color="red">{validationError}</Text>}

                <Box marginTop={1} gap={2}>
                    <Text dimColor>[Enter] Copy</Text>
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        </Panel>
    );

}
