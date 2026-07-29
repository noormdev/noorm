/**
 * SecretSetScreen - create or update a secret value.
 *
 * If a secret key is provided via params, edits that secret.
 * Otherwise shows a form to create a new secret.
 *
 * For required secrets (from stage definition), shows the description
 * and uses appropriate input type based on secret type.
 *
 * @example
 * ```bash
 * noorm secret:set DB_PASSWORD   # Set specific secret
 * noorm secret set               # Add new secret (prompts for key)
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { StageSecret } from '../../components/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { useVaultSecretKeys } from '../../hooks/index.js';
import { Panel, SecretValueForm, useToast } from '../../components/index.js';

/**
 * Simple error screen for when no active config exists.
 */
function NoConfigError({ title, message }: { title: string; message: string }): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('NoConfigError');

    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape || key.return) {

            back();

        }

    });

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={title} paddingX={2} paddingY={1} borderColor="yellow">
                <Box flexDirection="column" gap={1}>
                    <Text color="yellow">{message}</Text>
                    <Text dimColor>Use: noorm config:use &lt;name&gt;</Text>
                </Box>
            </Panel>

            <Box gap={2}>
                <Text color={isFocused ? 'cyan' : undefined} dimColor={!isFocused}>
                    [Esc] Back
                </Text>
            </Box>
        </Box>
    );

}

/**
 * SecretSetScreen component.
 *
 * Form for setting a secret value.
 */
export function SecretSetScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { activeConfig, activeConfigName, stateManager, refresh } =
        useAppContext();
    const { showToast } = useToast();
    const { vaultSecretKeys, requiredSecrets: rawRequiredSecrets, vaultError } = useVaultSecretKeys();

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Key from params (if editing existing secret)
    const secretKey = params.name;

    // Map required secrets to StageSecret[]
    const requiredSecrets = useMemo<StageSecret[]>(() => {

        return rawRequiredSecrets.map((s) => ({
            key: s.key,
            type: s.type as StageSecret['type'],
            description: s.description,
            required: true,
        }));

    }, [rawRequiredSecrets]);

    // Find matching required secret definition (if editing a required secret)
    const requiredSecretDef = useMemo(() => {

        if (!secretKey) return null;

        return requiredSecrets.find((s) => s.key === secretKey) ?? null;

    }, [secretKey, requiredSecrets]);

    // Check if secret already exists locally
    const secretExists = useMemo(() => {

        if (!stateManager || !activeConfigName || !secretKey) return false;

        return stateManager.getSecret(activeConfigName, secretKey) !== null;

    }, [stateManager, activeConfigName, secretKey]);

    // Check if secret exists in vault (will be overridden by local)
    const existsInVault = useMemo(() => {

        if (!secretKey) return false;

        return vaultSecretKeys.includes(secretKey);

    }, [secretKey, vaultSecretKeys]);

    // Get unset required secrets for suggestions
    const unsetRequired = useMemo(() => {

        if (!stateManager || !activeConfigName) return [];

        return requiredSecrets.filter(
            (s) => stateManager.getSecret(activeConfigName, s.key) === null,
        );

    }, [requiredSecrets, stateManager, activeConfigName]);

    // Handle form submission
    const handleSubmit = useCallback(
        async (key: string, value: string) => {

            if (!stateManager || !activeConfigName) {

                setError('No active configuration');

                return;

            }

            setSaving(true);
            setError(null);

            const [, err] = await attempt(async () => {

                await stateManager.setSecret(activeConfigName, key, value);
                await refresh();

            });

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setSaving(false);

                return;

            }

            // Success
            showToast({
                message: `Secret "${key}" saved`,
                variant: 'success',
            });
            back();

        },
        [stateManager, activeConfigName, refresh, showToast, back],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // No active config - show error with back option
    if (!activeConfigName || !activeConfig) {

        return (
            <NoConfigError
                title="Set Secret"
                message="No active configuration. Set an active config first."
            />
        );

    }

    // Title based on mode
    const title = secretKey
        ? secretExists
            ? `Update Secret: ${secretKey}`
            : `Set Secret: ${secretKey}`
        : 'Add Secret';

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={title} paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {/* Config context */}
                    <Text dimColor>Config: {activeConfigName}</Text>

                    {/* Vault override warning */}
                    {existsInVault && (
                        <Text color="yellow">
                            This secret exists in the vault. Setting it locally will override the vault value for this config.
                        </Text>
                    )}

                    <SecretValueForm
                        secretKey={secretKey}
                        secretDefinition={requiredSecretDef}
                        unsetRequired={unsetRequired}
                        secretExists={secretExists}
                        onSubmit={handleSubmit}
                        onCancel={handleCancel}
                        busy={saving}
                        error={error ?? vaultError}
                        focusLabel="SecretSetForm"
                    />
                </Box>
            </Panel>
        </Box>
    );

}
