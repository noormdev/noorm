/**
 * SettingsStageSecretRemoveScreen - delete a stage-specific secret definition.
 *
 * @example
 * ```bash
 * noorm settings stages prod secrets rm DB_PASSWORD
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
 * SettingsStageSecretRemoveScreen component.
 */
export function SettingsStageSecretRemoveScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('SettingsStageSecretRemove');
    const { settingsManager, settings, refresh } = useAppContext();
    const { showToast } = useToast();

    const stageName = params.stage;
    const secretKey = params.name;
    const [deleting, setDeleting] = useState(false);

    // Get stage
    const stage = useMemo(() => {

        if (!settings?.stages || !stageName) return null;

        return settings.stages[stageName];

    }, [settings, stageName]);

    // Find the secret
    const secret = useMemo(() => {

        if (!stage?.secrets || !secretKey) return null;

        return stage.secrets.find((s) => s.key === secretKey);

    }, [stage, secretKey]);

    // Handle confirm
    const handleConfirm = useCallback(async () => {

        if (!settingsManager || !stageName || !secretKey) return;

        setDeleting(true);

        const [_, err] = await attempt(async () => {

            await settingsManager.removeStageSecret(stageName, secretKey);
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
            message: `Secret "${secretKey}" removed from stage "${stageName}"`,
            variant: 'success',
        });
        back();

    }, [settingsManager, stageName, secretKey, refresh, showToast, back]);

    // Handle cancel
    const handleCancel = useCallback(() => back(), [back]);

    // Keyboard handling for error states
    useInput((input, key) => {

        if (!isFocused) return;

        if (!stageName || !secretKey || !stage || !secret) {

            if (key.escape || key.return) {

                back();

            }

        }

    });

    // Deleting state
    if (deleting) {

        return (
            <Panel title={`Delete: ${secretKey}`} paddingX={2} paddingY={1}>
                <Spinner label="Deleting secret from stage..." />
            </Panel>
        );

    }

    // No stage provided
    if (!stageName) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Remove Stage Secret" paddingX={2} paddingY={1} borderColor="yellow">
                    <Text color="yellow">No stage name provided.</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Stage not found
    if (!stage) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Remove Stage Secret" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">Stage "{stageName}" not found.</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // No key provided
    if (!secretKey) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Remove Stage Secret" paddingX={2} paddingY={1} borderColor="yellow">
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
                <Panel title="Remove Stage Secret" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">
                        Secret "{secretKey}" not found in stage "{stageName}".
                    </Text>
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
                <Text dimColor>Stage: {stageName}</Text>

                {/* Show description if available */}
                {secret.description && <Text dimColor>{secret.description}</Text>}

                <Text dimColor>Type: {secret.type}</Text>

                <Confirm
                    message={`Delete "${secretKey}" from stage "${stageName}"?`}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    variant="warning"
                    isFocused={isFocused}
                />
            </Box>
        </Panel>
    );

}
