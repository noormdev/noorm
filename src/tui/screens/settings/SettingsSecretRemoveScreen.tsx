/**
 * SettingsSecretRemoveScreen - delete a secret definition.
 *
 * Handles both universal secrets (all stages) and stage-specific secrets
 * based on the presence of `params.stage`.
 *
 * @example
 * ```bash
 * noorm settings secrets rm DB_PASSWORD                   # Remove universal secret
 * noorm settings stages prod secrets rm DB_PASSWORD       # Remove from stage
 * ```
 */
import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Confirm, Spinner, useToast } from '../../components/index.js';
import { getErrorMessage } from '../../utils/index.js';
import { useSecretSource } from '../../hooks/index.js';

/**
 * SettingsSecretRemoveScreen component.
 *
 * When `params.stage` is present, operates on stage-specific secrets.
 * Otherwise operates on universal secrets.
 */
export function SettingsSecretRemoveScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('SettingsSecretRemove');
    const { settingsManager, refresh } = useAppContext();
    const { showToast } = useToast();

    const { stageName, secretKey, existingSecret: secret, stage } = useSecretSource(params);
    const [deleting, setDeleting] = useState(false);

    // Handle confirm
    const handleConfirm = useCallback(async () => {

        if (!settingsManager || !secretKey) return;

        setDeleting(true);

        const [_, err] = await attempt(async () => {

            if (stageName) {

                await settingsManager.removeStageSecret(stageName, secretKey);

            }
            else {

                await settingsManager.removeUniversalSecret(secretKey);

            }

            await refresh();

        });

        if (err) {

            showToast({
                message: getErrorMessage(err),
                variant: 'error',
            });
            setDeleting(false);

            return;

        }

        const scopeLabel = stageName ? ` from stage "${stageName}"` : '';

        showToast({
            message: `Secret definition "${secretKey}" removed${scopeLabel}`,
            variant: 'success',
        });
        back();

    }, [settingsManager, stageName, secretKey, refresh, showToast, back]);

    // Handle cancel
    const handleCancel = useCallback(() => back(), [back]);

    // Keyboard handling for error states
    useInput((input, key) => {

        if (!isFocused) return;

        if (!secretKey || !secret || (stageName && !stage)) {

            if (key.escape || key.return) {

                back();

            }

        }

    });

    // Deleting state
    if (deleting) {

        return (
            <Panel title={`Delete: ${secretKey}`} paddingX={2} paddingY={1}>
                <Spinner label={stageName ? 'Deleting secret from stage...' : 'Deleting secret definition...'} />
            </Panel>
        );

    }

    // Stage not found (stage mode only)
    if (stageName && !stage) {

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
                <Panel
                    title={stageName ? 'Remove Stage Secret' : 'Remove Secret Definition'}
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

        const notFoundMsg = stageName
            ? `Secret "${secretKey}" not found in stage "${stageName}".`
            : `Secret "${secretKey}" not found.`;

        return (
            <Box flexDirection="column" gap={1}>
                <Panel
                    title={stageName ? 'Remove Stage Secret' : 'Remove Secret Definition'}
                    paddingX={2}
                    paddingY={1}
                    borderColor="red"
                >
                    <Text color="red">{notFoundMsg}</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Build confirm message and title
    const confirmMsg = stageName
        ? `Delete "${secretKey}" from stage "${stageName}"?`
        : `Delete secret definition "${secretKey}"?`;

    const title = `Remove: ${secretKey}`;

    return (
        <Panel title={title} paddingX={2} paddingY={1} borderColor="yellow">
            <Box flexDirection="column" gap={1}>
                {stageName && <Text dimColor>Stage: {stageName}</Text>}

                {/* Show description if available */}
                {secret.description && <Text dimColor>{secret.description}</Text>}

                <Text dimColor>Type: {secret.type}</Text>

                {!stageName && (
                    <Text color="yellow">
                        Warning: This will remove the secret requirement from all stages.
                    </Text>
                )}

                <Confirm
                    message={confirmMsg}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    variant="warning"
                    isFocused={isFocused}
                />
            </Box>
        </Panel>
    );

}
