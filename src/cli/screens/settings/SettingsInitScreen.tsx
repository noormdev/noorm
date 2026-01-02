/**
 * SettingsInitScreen - initialize or reset settings file.
 *
 * Creates .noorm/settings.yml with default values.
 * Warns before overwriting an existing file.
 *
 * @example
 * ```bash
 * noorm settings:init           # Create settings file
 * noorm settings:init --force   # Overwrite existing
 * ```
 */
import { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Confirm, Spinner, useToast } from '../../components/index.js';

type InitStep =
    | 'checking'
    | 'confirm-create'
    | 'confirm-overwrite'
    | 'initializing'
    | 'complete'
    | 'error';

/**
 * SettingsInitScreen component.
 */
export function SettingsInitScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('SettingsInit');
    const { settingsManager, refresh } = useAppContext();
    const { showToast } = useToast();

    const force = params.force ?? false;

    const [step, setStep] = useState<InitStep>('checking');
    const [error, setError] = useState<string | null>(null);

    // Check if settings file exists
    useEffect(() => {

        if (!settingsManager) {

            setError('Settings manager not available');
            setStep('error');

            return;

        }

        const checkExists = async () => {

            const exists = await settingsManager.exists();

            if (exists) {

                if (force) {

                    // Force flag - skip confirmation
                    setStep('initializing');
                    await handleInit(true);

                }
                else {

                    setStep('confirm-overwrite');

                }

            }
            else {

                setStep('confirm-create');

            }

        };

        checkExists();

    }, [settingsManager, force]);

    // Handle initialization
    const handleInit = useCallback(
        async (forceOverwrite: boolean) => {

            if (!settingsManager) {

                setError('Settings manager not available');
                setStep('error');

                return;

            }

            setStep('initializing');

            const [_, err] = await attempt(async () => {

                await settingsManager.init(forceOverwrite);
                await refresh();

            });

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setStep('error');

                return;

            }

            showToast({
                message: forceOverwrite
                    ? 'Settings file reset to defaults'
                    : 'Settings file created',
                variant: 'success',
            });
            back();

        },
        [settingsManager, refresh, showToast, back],
    );

    // Handle confirm create
    const handleConfirmCreate = useCallback(() => {

        handleInit(false);

    }, [handleInit]);

    // Handle confirm overwrite
    const handleConfirmOverwrite = useCallback(() => {

        handleInit(true);

    }, [handleInit]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Keyboard handling for error state
    useInput((input, key) => {

        if (!isFocused) return;

        if (step === 'error') {

            if (key.escape || key.return) {

                back();

            }

        }

    });

    // Checking state
    if (step === 'checking') {

        return (
            <Panel title="Initialize Settings" paddingX={2} paddingY={1}>
                <Spinner label="Checking settings file..." />
            </Panel>
        );

    }

    // Initializing state
    if (step === 'initializing') {

        return (
            <Panel title="Initialize Settings" paddingX={2} paddingY={1}>
                <Spinner label="Creating settings file..." />
            </Panel>
        );

    }

    // Error state
    if (step === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Initialize Settings" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">{error ?? 'An error occurred'}</Text>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Confirm create (file doesn't exist)
    if (step === 'confirm-create') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Initialize Settings" paddingX={2} paddingY={1} borderColor="cyan">
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            This will create <Text color="cyan">.noorm/settings.yml</Text> with
                            default values:
                        </Text>
                        <Box marginLeft={2} flexDirection="column">
                            <Text dimColor>- build: include schema folder</Text>
                            <Text dimColor>- paths: ./sql, ./changes</Text>
                            <Text dimColor>- rules: none</Text>
                            <Text dimColor>- stages: none</Text>
                            <Text dimColor>- strict: disabled</Text>
                            <Text dimColor>- logging: info level</Text>
                        </Box>
                    </Box>
                </Panel>

                <Confirm
                    message="Create settings file?"
                    onConfirm={handleConfirmCreate}
                    onCancel={handleCancel}
                    isFocused={isFocused}
                />
            </Box>
        );

    }

    // Confirm overwrite (file exists)
    if (step === 'confirm-overwrite') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Initialize Settings" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">Settings file already exists.</Text>
                        <Text>Overwriting will reset all settings to defaults:</Text>
                        <Box marginLeft={2} flexDirection="column">
                            <Text dimColor>- All stages will be removed</Text>
                            <Text dimColor>- All rules will be removed</Text>
                            <Text dimColor>- All custom paths will be reset</Text>
                        </Box>
                    </Box>
                </Panel>

                <Confirm
                    message="Overwrite existing settings?"
                    onConfirm={handleConfirmOverwrite}
                    onCancel={handleCancel}
                    variant="warning"
                    isFocused={isFocused}
                />
            </Box>
        );

    }

    // Should not reach here
    return (
        <Panel title="Initialize Settings" paddingX={2} paddingY={1}>
            <Text dimColor>Processing...</Text>
        </Panel>
    );

}
