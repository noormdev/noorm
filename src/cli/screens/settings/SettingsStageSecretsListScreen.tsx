/**
 * SettingsStageSecretsListScreen - list secrets for a specific stage.
 *
 * Shows secrets defined for a specific stage. These are stage-specific
 * requirements in addition to any universal secrets.
 *
 * Keyboard shortcuts:
 * - Enter/e: Edit selected secret
 * - a: Add new secret
 * - d: Delete selected secret
 *
 * @example
 * ```bash
 * noorm settings stages prod secrets    # List prod stage secrets
 * ```
 */
import { useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import {
    Panel,
    SecretDefinitionList,
    SecretDefinitionListHelp,
    useToast,
} from '../../components/index.js';

/**
 * SettingsStageSecretsListScreen component.
 */
export function SettingsStageSecretsListScreen({ params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('SettingsStageSecretsList');
    const { settingsManager, settings, refresh } = useAppContext();
    const { showToast } = useToast();

    const stageName = params.name;

    // Get stage
    const stage = useMemo(() => {

        if (!settings?.stages || !stageName) return null;

        return settings.stages[stageName];

    }, [settings, stageName]);

    // Get stage secrets
    const secrets = useMemo(() => stage?.secrets ?? [], [stage]);

    // Handle add
    const handleAdd = useCallback(() => {

        navigate('settings/stages/secrets/add', { stage: stageName });

    }, [navigate, stageName]);

    // Handle edit
    const handleEdit = useCallback(
        (secretKey: string) => {

            navigate('settings/stages/secrets/edit', { stage: stageName, name: secretKey });

        },
        [navigate, stageName],
    );

    // Handle delete
    const handleDelete = useCallback(
        async (secretKey: string) => {

            if (!settingsManager || !stageName) return;

            const [_, err] = await attempt(async () => {

                await settingsManager.removeStageSecret(stageName, secretKey);
                await refresh();

            });

            if (err) {

                showToast({
                    message: err instanceof Error ? err.message : String(err),
                    variant: 'error',
                });

                return;

            }

            showToast({
                message: `Secret definition "${secretKey}" deleted from stage`,
                variant: 'success',
            });

        },
        [settingsManager, stageName, refresh, showToast],
    );

    // Handle back for error states
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

        }

    });

    // No stage name provided
    if (!stageName) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Stage Secrets" paddingX={2} paddingY={1} borderColor="yellow">
                    <Text color="yellow">No stage name provided.</Text>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Stage not found
    if (!stage) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Stage Secrets" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">Stage "{stageName}" not found.</Text>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={`Secrets for Stage: ${stageName}`} paddingX={1} paddingY={1}>
                <SecretDefinitionList
                    secrets={secrets}
                    scopeLabel={`stage: ${stageName}`}
                    onAdd={handleAdd}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    isFocused={isFocused}
                    onBack={back}
                />
            </Panel>

            <SecretDefinitionListHelp />
        </Box>
    );

}
