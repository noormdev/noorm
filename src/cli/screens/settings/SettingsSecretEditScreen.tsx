/**
 * SettingsSecretEditScreen - add or edit a universal secret definition.
 *
 * Universal secrets apply to ALL stages.
 *
 * @example
 * ```bash
 * noorm settings secrets add           # Add new secret
 * noorm settings secrets edit DB_PASS  # Edit secret definition
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Text } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { StageSecret } from '../../components/index.js';

import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel, SecretDefinitionForm, useToast } from '../../components/index.js';

/**
 * SettingsSecretEditScreen component.
 */
export function SettingsSecretEditScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { settingsManager, settings, refresh } = useAppContext();
    const { showToast } = useToast();

    const secretKey = params.name;
    const isAddMode = !secretKey;

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get existing secret if editing
    const existingSecret = useMemo(() => {

        if (!settings?.secrets || !secretKey) return null;

        return settings.secrets.find((s) => s.key === secretKey);

    }, [settings, secretKey]);

    // Get all secret keys for validation
    const existingKeys = useMemo(() => {

        if (!settings?.secrets) return [];

        return settings.secrets.map((s) => s.key);

    }, [settings]);

    // Handle submit
    const handleSubmit = useCallback(
        async (secret: StageSecret) => {

            if (!settingsManager) {

                setError('Settings manager not available');

                return;

            }

            setBusy(true);
            setError(null);

            const [_, err] = await attempt(async () => {

                if (isAddMode) {

                    await settingsManager.addUniversalSecret(secret);

                }
                else {

                    // If key changed, need to remove old and add new
                    if (secretKey !== secret.key) {

                        await settingsManager.removeUniversalSecret(secretKey!);
                        await settingsManager.addUniversalSecret(secret);

                    }
                    else {

                        await settingsManager.updateUniversalSecret(secretKey!, secret);

                    }

                }

            });

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setBusy(false);

                return;

            }

            showToast({
                message: isAddMode
                    ? `Secret definition "${secret.key}" created`
                    : `Secret definition "${secret.key}" updated`,
                variant: 'success',
            });
            back();

        },
        [settingsManager, secretKey, isAddMode, refresh, showToast, back],
    );

    // Handle cancel
    const handleCancel = useCallback(() => back(), [back]);

    // Not found state
    if (!isAddMode && !existingSecret) {

        return (
            <Panel title="Edit Secret Definition" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">Secret "{secretKey}" not found.</Text>
            </Panel>
        );

    }

    return (
        <Panel
            title={isAddMode ? 'Add Secret Definition' : `Edit: ${secretKey}`}
            paddingX={2}
            paddingY={1}
        >
            <SecretDefinitionForm
                existingSecret={existingSecret}
                existingKeys={existingKeys}
                isAddMode={isAddMode}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                busy={busy}
                error={error}
                focusLabel="SettingsSecretEditForm"
            />
        </Panel>
    );

}
