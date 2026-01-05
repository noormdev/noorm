/**
 * SettingsSecretRemoveScreen - delete a universal secret definition.
 *
 * @example
 * ```bash
 * noorm settings secrets rm DB_PASSWORD
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
import { Panel, Confirm, Spinner, useToast } from '../../components/index.js';

/**
 * SettingsSecretRemoveScreen component.
 */
export function SettingsSecretRemoveScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('SettingsSecretRemove');
    const { settingsManager, settings, refresh } = useAppContext();
    const { showToast } = useToast();

    const secretKey = params.name;
    const [deleting, setDeleting] = useState(false);

    // Find the secret
    const secret = useMemo(() => {

        if (!settings?.secrets || !secretKey) return null;

        return settings.secrets.find((s) => s.key === secretKey);

    }, [settings, secretKey]);

    // Handle confirm
    const handleConfirm = useCallback(async () => {

        if (!settingsManager || !secretKey) return;

        setDeleting(true);

        const [_, err] = await attempt(async () => {

            await settingsManager.removeUniversalSecret(secretKey);
            await refresh();

        });

        if (err) {

            showToast({
                message: err instanceof Error ? err.message : String(err),
                variant: 'error',
            });
            setDeleting(false);

            return;

        }

        showToast({
            message: `Secret definition "${secretKey}" removed`,
            variant: 'success',
        });
        back();

    }, [settingsManager, secretKey, refresh, showToast, back]);

    // Handle cancel
    const handleCancel = useCallback(() => back(), [back]);

    // Keyboard handling for error states
    useInput((input, key) => {

        if (!isFocused) return;

        if (!secretKey || !secret) {

            if (key.escape || key.return) {

                back();

            }

        }

    });

    // Deleting state
    if (deleting) {

        return (
            <Panel title={`Delete: ${secretKey}`} paddingX={2} paddingY={1}>
                <Spinner label="Deleting secret definition..." />
            </Panel>
        );

    }

    // No key provided
    if (!secretKey) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel
                    title="Remove Secret Definition"
                    paddingX={2}
                    paddingY={1}
                    borderColor="yellow"
                >
                    <Text color="yellow">No secret key provided.</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Not found
    if (!secret) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Remove Secret Definition" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">Secret "{secretKey}" not found.</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    return (
        <Panel title={`Remove: ${secretKey}`} paddingX={2} paddingY={1} borderColor="yellow">
            <Box flexDirection="column" gap={1}>
                {/* Show description if available */}
                {secret.description && <Text dimColor>{secret.description}</Text>}

                <Text dimColor>Type: {secret.type}</Text>

                <Text color="yellow">
                    Warning: This will remove the secret requirement from all stages.
                </Text>

                <Confirm
                    message={`Delete secret definition "${secretKey}"?`}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    variant="warning"
                    isFocused={isFocused}
                />
            </Box>
        </Panel>
    );

}
