/**
 * SecretListScreen - displays secrets for the active config.
 *
 * Shows secrets grouped by required (from stage definition) and optional.
 * Required secrets show their type and status (set/missing).
 * Values are never displayed for security.
 *
 * Keyboard shortcuts:
 * - a: Add/set a secret
 * - d: Delete selected secret
 * - Enter: Edit selected secret value
 * - Esc: Go back
 *
 * @example
 * ```bash
 * noorm secret           # Opens this screen
 * ```
 */
import { useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import {
    Panel,
    SecretValueList,
    SecretValueListHelp,
    type SecretValueItem,
} from '../../components/index.js';

/**
 * SecretListScreen component.
 *
 * Displays all secrets for the active config with quick actions.
 */
export function SecretListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('SecretList');
    const { activeConfig, activeConfigName, stateManager, settingsManager } = useAppContext();

    // Try to match config name to a stage (common pattern: config "prod" -> stage "prod")
    const stageName = activeConfigName;

    // Get required secrets (universal + stage-specific merged)
    const requiredSecrets = useMemo(() => {

        if (!stageName || !settingsManager) return [];

        return settingsManager.getRequiredSecrets(stageName);

    }, [stageName, settingsManager]);

    // Get stored secrets for active config
    const storedSecretKeys = useMemo<string[]>(() => {

        if (!stateManager || !activeConfigName) return [];

        return stateManager.listSecrets(activeConfigName);

    }, [stateManager, activeConfigName]);

    // Build combined list: required + optional (stored but not required)
    const allSecrets = useMemo<SecretValueItem[]>(() => {

        const result: SecretValueItem[] = [];
        const requiredKeys = new Set(requiredSecrets.map((s) => s.key));

        // Add required secrets first
        for (const required of requiredSecrets) {

            result.push({
                key: required.key,
                isRequired: true,
                isSet: storedSecretKeys.includes(required.key),
                type: required.type,
                description: required.description,
            });

        }

        // Add optional secrets (stored but not in required list)
        for (const key of storedSecretKeys) {

            if (!requiredKeys.has(key)) {

                result.push({
                    key,
                    isRequired: false,
                    isSet: true,
                });

            }

        }

        return result;

    }, [requiredSecrets, storedSecretKeys]);

    // Required keys set for delete check
    const requiredKeys = useMemo(() => {

        return new Set(requiredSecrets.map((s) => s.key));

    }, [requiredSecrets]);

    // Handle add
    const handleAdd = useCallback(() => {

        navigate('secret/set');

    }, [navigate]);

    // Handle edit
    const handleEdit = useCallback(
        (secretKey: string) => {

            navigate('secret/set', { name: secretKey });

        },
        [navigate],
    );

    // Handle delete
    const handleDelete = useCallback(
        (secretKey: string) => {

            navigate('secret/rm', { name: secretKey });

        },
        [navigate],
    );

    // Check if can delete (only optional secrets can be deleted)
    const canDelete = useCallback(
        (secretKey: string) => {

            return !requiredKeys.has(secretKey);

        },
        [requiredKeys],
    );

    // Handle back for error state
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape && (!activeConfigName || !activeConfig)) {

            back();

        }

    });

    // No active config
    if (!activeConfigName || !activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Secrets" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">No active configuration.</Text>
                        <Text>Set an active config first with: noorm config:use &lt;name&gt;</Text>
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={`Secrets for "${activeConfigName}"`} paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {/* Stage info */}
                    {stageName && <Text dimColor>Stage: {stageName}</Text>}

                    <SecretValueList
                        secrets={allSecrets}
                        onAdd={handleAdd}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        canDelete={canDelete}
                        isFocused={isFocused}
                        onBack={back}
                    />
                </Box>
            </Panel>

            <SecretValueListHelp />
        </Box>
    );

}
