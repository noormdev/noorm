/**
 * SettingsSecretEditScreen - add or edit a secret definition.
 *
 * Handles both universal secrets (all stages) and stage-specific secrets
 * based on the presence of `params.stage`.
 *
 * @example
 * ```bash
 * noorm settings secrets add                          # Add universal secret
 * noorm settings secrets edit DB_PASS                 # Edit universal secret
 * noorm settings stages prod secrets add              # Add secret to prod
 * noorm settings stages prod secrets edit DB_PASS     # Edit secret in prod
 * ```
 */
import { useCallback } from 'react';
import { Box, Text } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { StageSecret } from '../../components/index.js';

import { useRouter } from '../../router.js';
import { Panel, SecretDefinitionForm } from '../../components/index.js';
import { useSettingsOperation, useSecretSource } from '../../hooks/index.js';

/**
 * SettingsSecretEditScreen component.
 *
 * When `params.stage` is present, operates on stage-specific secrets.
 * Otherwise operates on universal secrets.
 */
export function SettingsSecretEditScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { stageName, secretKey, existingSecret, existingKeys, stage } = useSecretSource(params);

    const isAddMode = !secretKey;
    const scopeLabel = stageName ? ` in stage "${stageName}"` : '';

    const { execute, busy, error } = useSettingsOperation(
        async (mgr, secret: StageSecret) => {

            if (isAddMode) {

                if (stageName) {

                    await mgr.addStageSecret(stageName, secret);

                }
                else {

                    await mgr.addUniversalSecret(secret);

                }

            }
            else {

                if (secretKey !== secret.key) {

                    if (stageName) {

                        await mgr.removeStageSecret(stageName, secretKey!);
                        await mgr.addStageSecret(stageName, secret);

                    }
                    else {

                        await mgr.removeUniversalSecret(secretKey!);
                        await mgr.addUniversalSecret(secret);

                    }

                }
                else {

                    if (stageName) {

                        await mgr.updateStageSecret(stageName, secretKey!, secret);

                    }
                    else {

                        await mgr.updateUniversalSecret(secretKey!, secret);

                    }

                }

            }

        },
        (secret) => isAddMode
            ? `Secret definition "${secret.key}" created${scopeLabel}`
            : `Secret definition "${secret.key}" updated${scopeLabel}`,
    );

    // Handle submit
    const handleSubmit = useCallback(
        async (secret: StageSecret) => {

            await execute(secret);

        },
        [execute],
    );

    // Handle cancel
    const handleCancel = useCallback(() => back(), [back]);

    // Stage not found (stage mode only)
    if (stageName && !stage) {

        return (
            <Panel title="Edit Stage Secret" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">Stage "{stageName}" not found.</Text>
            </Panel>
        );

    }

    // Secret not found (edit mode)
    if (!isAddMode && !existingSecret) {

        const notFoundMsg = stageName
            ? `Secret "${secretKey}" not found in stage "${stageName}".`
            : `Secret "${secretKey}" not found.`;

        return (
            <Panel title="Edit Secret Definition" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">{notFoundMsg}</Text>
            </Panel>
        );

    }

    // Build title
    const title = isAddMode
        ? (stageName ? `Add Secret to ${stageName}` : 'Add Secret Definition')
        : (stageName ? `Edit: ${secretKey} (${stageName})` : `Edit: ${secretKey}`);

    const form = (
        <SecretDefinitionForm
            existingSecret={existingSecret}
            existingKeys={existingKeys}
            isAddMode={isAddMode}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            busy={busy}
            error={error}
            focusLabel={stageName ? 'SettingsStageSecretEditForm' : 'SettingsSecretEditForm'}
        />
    );

    return (
        <Panel title={title} paddingX={2} paddingY={1}>
            {stageName ? (
                <Box flexDirection="column" gap={1}>
                    <Text dimColor>Stage: {stageName}</Text>
                    {form}
                </Box>
            ) : form}
        </Panel>
    );

}
