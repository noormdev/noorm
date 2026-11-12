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
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, useToast, MissingParamPanel, NotFoundPanel, TextInput } from '../../components/index.js';
import { SettingsProvider } from '../../../core/config/resolver.js';
import { getErrorMessage, validateConfigName } from '../../utils/index.js';
import { Hotkey } from '../../components/layout/Hotkey.js';

/**
 * ConfigCopyScreen component.
 */
export function ConfigCopyScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('ConfigCopy');
    const { stateManager, settingsManager, configs, refresh } = useAppContext();
    const { showToast } = useToast();

    const configName = params.name;

    const settingsProvider = useMemo(
        () => (settingsManager ? new SettingsProvider(settingsManager) : null),
        [settingsManager],
    );

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

            if (!settingsProvider) throw new Error('Settings are not available');

            await stateManager.copyConfig(configName, newName, settingsProvider);
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

    }, [stateManager, config, configName, newName, configs, settingsProvider, refresh, showToast, back]);

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
                    <Hotkey keys="Enter">Copy</Hotkey>
                    <Hotkey keys="Esc">Cancel</Hotkey>
                </Box>
            </Box>
        </Panel>
    );

}
