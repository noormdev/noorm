/**
 * SettingsStageSecretEditScreen - add or edit a stage-specific secret definition.
 *
 * These secrets apply only to the specific stage.
 *
 * @example
 * ```bash
 * noorm settings stages prod secrets add              # Add new secret to prod
 * noorm settings stages prod secrets edit DB_PASS     # Edit secret in prod
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { StageSecret } from '../../components/index.js';

import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel, SecretDefinitionForm, useToast } from '../../components/index.js';

/**
 * SettingsStageSecretEditScreen component.
 */
export function SettingsStageSecretEditScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { settingsManager, settings, refresh } = useAppContext();
    const { showToast } = useToast();

    const stageName = params.stage;
    const secretKey = params.name;
    const isAddMode = !secretKey;

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get stage
    const stage = useMemo(() => {

        if (!settings?.stages || !stageName) return null;

        return settings.stages[stageName];

    }, [settings, stageName]);

    // Get existing secret if editing
    const existingSecret = useMemo(() => {

        if (!stage?.secrets || !secretKey) return null;

        return stage.secrets.find((s) => s.key === secretKey);

    }, [stage, secretKey]);

    // Get all secret keys for validation
    const existingKeys = useMemo(() => {

        if (!stage?.secrets) return [];

        return stage.secrets.map((s) => s.key);

    }, [stage]);

    // Handle submit
    const handleSubmit = useCallback(
        async (secret: StageSecret) => {

            if (!settingsManager || !stageName) {

                setError('Settings manager not available');

                return;

            }

            setBusy(true);
            setError(null);

            const [_, err] = await attempt(async () => {

                if (isAddMode) {

                    await settingsManager.addStageSecret(stageName, secret);

                }
                else {

                    // If key changed, need to remove old and add new
                    if (secretKey !== secret.key) {

                        await settingsManager.removeStageSecret(stageName, secretKey!);
                        await settingsManager.addStageSecret(stageName, secret);

                    }
                    else {

                        await settingsManager.updateStageSecret(stageName, secretKey!, secret);

                    }

                }

                await refresh();

            });

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setBusy(false);

                return;

            }

            showToast({
                message: isAddMode
                    ? `Secret "${secret.key}" added to stage "${stageName}"`
                    : `Secret "${secret.key}" updated in stage "${stageName}"`,
                variant: 'success',
            });
            back();

        },
        [settingsManager, stageName, secretKey, isAddMode, refresh, showToast, back],
    );

    // Handle cancel
    const handleCancel = useCallback(() => back(), [back]);

    // No stage provided
    if (!stageName) {

        return (
            <Panel title="Edit Stage Secret" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No stage name provided.</Text>
            </Panel>
        );

    }

    // Stage not found
    if (!stage) {

        return (
            <Panel title="Edit Stage Secret" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">Stage "{stageName}" not found.</Text>
            </Panel>
        );

    }

    // Secret not found (edit mode)
    if (!isAddMode && !existingSecret) {

        return (
            <Panel title="Edit Stage Secret" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">
                    Secret "{secretKey}" not found in stage "{stageName}".
                </Text>
            </Panel>
        );

    }

    return (
        <Panel
            title={isAddMode ? `Add Secret to ${stageName}` : `Edit: ${secretKey} (${stageName})`}
            paddingX={2}
            paddingY={1}
        >
            <Box flexDirection="column" gap={1}>
                <Text dimColor>Stage: {stageName}</Text>

                <SecretDefinitionForm
                    existingSecret={existingSecret}
                    existingKeys={existingKeys}
                    isAddMode={isAddMode}
                    onSubmit={handleSubmit}
                    onCancel={handleCancel}
                    busy={busy}
                    error={error}
                    focusLabel="SettingsStageSecretEditForm"
                />
            </Box>
        </Panel>
    );

}
