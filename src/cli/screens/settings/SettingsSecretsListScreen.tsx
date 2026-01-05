/**
 * SettingsSecretsListScreen - list universal secret definitions.
 *
 * Shows secrets defined at the top-level settings.secrets array.
 * These secrets apply to ALL stages.
 *
 * Keyboard shortcuts:
 * - Enter/e: Edit selected secret
 * - a: Add new secret
 * - d: Delete selected secret
 *
 * @example
 * ```bash
 * noorm settings secrets    # List universal secrets
 * ```
 */
import { useCallback } from 'react';
import { Box, Text } from 'ink';
import { attempt, wait } from '@logosdx/utils';

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
 * SettingsSecretsListScreen component.
 */
export function SettingsSecretsListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('SettingsSecretsList');
    const { settingsManager, settings, refresh } = useAppContext();
    const { showToast } = useToast();

    // Get universal secrets
    const secrets = settings?.secrets ?? [];

    // Handle add
    const handleAdd = useCallback(() => {

        navigate('settings/secrets/add');

    }, [navigate]);

    // Handle edit
    const handleEdit = useCallback(
        (secretKey: string) => {

            navigate('settings/secrets/edit', { name: secretKey });

        },
        [navigate],
    );

    // Handle delete
    const handleDelete = useCallback(
        async (secretKey: string) => {

            if (!settingsManager) return;

            const [_, err] = await attempt(async () => {

                await settingsManager.removeUniversalSecret(secretKey);

            });

            if (err) {

                showToast({
                    message: err instanceof Error ? err.message : String(err),
                    variant: 'error',
                });

                return;

            }

            showToast({
                message: `Secret definition "${secretKey}" deleted`,
                variant: 'success',
            });

            await wait(50);
            await refresh();

        },
        [settingsManager, refresh, showToast],
    );

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Universal Secrets" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Box flexDirection="column">
                        <Text dimColor>
                            Define which secrets are <Text bold>required</Text> for all configs, regardless of stage.
                        </Text>
                        <Text dimColor>
                            Actual values are set per-config via <Text bold>Home › Secrets</Text>.
                        </Text>
                    </Box>
                    <SecretDefinitionList
                        secrets={secrets}
                        scopeLabel="universal"
                        onAdd={handleAdd}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        deleteWarning="This will remove the secret requirement from all stages."
                        isFocused={isFocused}
                        onBack={back}
                    />
                </Box>
            </Panel>

            <SecretDefinitionListHelp />
        </Box>
    );

}
