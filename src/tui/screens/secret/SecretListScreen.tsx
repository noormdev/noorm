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
import { useVaultSecretKeys } from '../../hooks/index.js';
import {
    Panel,
    SecretValueList,
    SecretValueListHelp,
    useToast,
    type SecretValueItem,
} from '../../components/index.js';
import { maskValue } from '../../../core/logger/redact.js';

/**
 * SecretListScreen component.
 *
 * Displays all secrets for the active config with quick actions.
 */
export function SecretListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('SecretList');
    const { activeConfig, activeConfigName, stateManager, settingsManager } = useAppContext();
    const { showToast } = useToast();
    const { vaultSecretKeys, requiredSecrets } = useVaultSecretKeys();

    // Get stored secrets for active config
    const storedSecretKeys = useMemo<string[]>(() => {

        if (!stateManager || !activeConfigName) return [];

        return stateManager.listSecrets(activeConfigName);

    }, [stateManager, activeConfigName]);

    // Build combined list: required + optional (stored but not required)
    const allSecrets = useMemo<SecretValueItem[]>(() => {

        const result: SecretValueItem[] = [];
        const requiredKeys = new Set(requiredSecrets.map((s) => s.key));

        // All available secrets (local + vault)
        const availableSecrets = new Set([...storedSecretKeys, ...vaultSecretKeys]);

        // Helper to get masked value for a key
        const getMasked = (key: string): string | undefined => {

            if (!stateManager || !activeConfigName) return undefined;

            const value = stateManager.getSecret(activeConfigName, key);

            return value ? maskValue(value, key, 'verbose') : undefined;

        };

        // Helper to check if secret is from vault only
        const isVaultOnly = (key: string): boolean => {

            return vaultSecretKeys.includes(key) && !storedSecretKeys.includes(key);

        };

        // Add required secrets first
        for (const required of requiredSecrets) {

            const isSet = availableSecrets.has(required.key);
            const fromVault = isVaultOnly(required.key);

            result.push({
                key: required.key,
                isRequired: true,
                isSet,
                type: required.type,
                description: fromVault ? `${required.description ?? ''} (vault)`.trim() : required.description,
                maskedValue: isSet && !fromVault ? getMasked(required.key) : (fromVault ? '(vault)' : undefined),
            });

        }

        // Add optional secrets (stored but not in required list)
        for (const key of storedSecretKeys) {

            if (!requiredKeys.has(key)) {

                result.push({
                    key,
                    isRequired: false,
                    isSet: true,
                    maskedValue: getMasked(key),
                });

            }

        }

        return result;

    }, [requiredSecrets, storedSecretKeys, vaultSecretKeys, stateManager, activeConfigName]);

    // Required keys set for delete check
    const requiredKeys = useMemo(() => {

        return new Set(requiredSecrets.map((s) => s.key));

    }, [requiredSecrets]);

    // Universal secret keys (to distinguish from stage-specific in messages)
    const universalKeys = useMemo(() => {

        if (!settingsManager) return new Set<string>();

        const universalSecrets = settingsManager.getUniversalSecrets();

        return new Set(universalSecrets.map((s) => s.key));

    }, [settingsManager]);

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

    // Check if can delete (required secrets can be deleted if they exist in vault)
    const canDelete = useCallback(
        (secretKey: string) => {

            const isRequired = requiredKeys.has(secretKey);
            const inVault = vaultSecretKeys.includes(secretKey);

            // Can delete if not required, or if required but exists in vault
            return !isRequired || inVault;

        },
        [requiredKeys, vaultSecretKeys],
    );

    // Handle blocked delete (show toast with reason)
    const handleDeleteBlocked = useCallback(
        (secretKey: string) => {

            const isUniversal = universalKeys.has(secretKey);
            const scope = isUniversal ? 'universal' : 'stage';

            showToast({
                message: `"${secretKey}" is a ${scope} secret and cannot be deleted (not in vault)`,
                variant: 'warning',
            });

        },
        [universalKeys, showToast],
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

                <Box flexWrap="wrap" columnGap={2}>
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
                    {activeConfigName && <Text dimColor>Stage: {activeConfigName}</Text>}

                    <SecretValueList
                        secrets={allSecrets}
                        onAdd={handleAdd}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        canDelete={canDelete}
                        onDeleteBlocked={handleDeleteBlocked}
                        isFocused={isFocused}
                        onBack={back}
                    />
                </Box>
            </Panel>

            <SecretValueListHelp />
        </Box>
    );

}
