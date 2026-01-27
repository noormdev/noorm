/**
 * SecretRemoveScreen - delete a secret from the active config.
 *
 * Required secrets (defined by stage) cannot be deleted, only updated.
 * Shows confirmation before deletion for optional secrets.
 *
 * @example
 * ```bash
 * noorm secret:rm MY_API_KEY   # Delete specific secret
 * noorm secret rm MY_API_KEY   # Same thing
 * ```
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';
import type { ConnectionResult } from '../../../core/connection/types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Confirm, Spinner, useToast } from '../../components/index.js';
import { createConnection } from '../../../core/connection/index.js';
import { getVaultStatus, getVaultKey, getAllVaultSecrets } from '../../../core/vault/index.js';
import { loadPrivateKey } from '../../../core/identity/storage.js';

/**
 * SecretRemoveScreen component.
 */
export function SecretRemoveScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('SecretRemove');
    const { activeConfig, activeConfigName, stateManager, settingsManager, identity, refresh } =
        useAppContext();
    const { showToast } = useToast();

    const secretKey = params.name;

    const [deleting, setDeleting] = useState(false);
    const [vaultSecretKeys, setVaultSecretKeys] = useState<string[]>([]);
    const connRef = useRef<ConnectionResult | null>(null);
    const loadingRef = useRef(false);

    // Load vault secrets on mount
    useEffect(() => {

        if (!activeConfig || !activeConfigName || !identity) return;
        if (loadingRef.current) return;
        loadingRef.current = true;

        let cancelled = false;

        const loadVaultSecrets = async (): Promise<void> => {

            const [conn, connErr] = await attempt(() =>
                createConnection(activeConfig.connection, activeConfigName),
            );

            if (connErr || !conn || cancelled) return;

            connRef.current = conn;
            const db = conn.db as Kysely<NoormDatabase>;

            const vaultStatus = await getVaultStatus(db, identity.identityHash);

            if (vaultStatus.hasAccess && !cancelled) {

                const privateKey = await loadPrivateKey();

                if (privateKey && !cancelled) {

                    const vaultKey = await getVaultKey(db, identity.identityHash, privateKey);

                    if (vaultKey && !cancelled) {

                        const allSecrets = await getAllVaultSecrets(db, vaultKey);
                        setVaultSecretKeys(Object.keys(allSecrets));

                    }

                }

            }

            await conn.destroy();
            connRef.current = null;

        };

        loadVaultSecrets();

        return () => {

            cancelled = true;

            if (connRef.current) {

                connRef.current.destroy();
                connRef.current = null;

            }

        };

    }, [activeConfig, activeConfigName, identity]);

    // Try to match config name to a stage (common pattern: config "prod" -> stage "prod")
    const stageName = activeConfigName;

    // Get required secrets (universal + stage-specific merged)
    const requiredSecrets = useMemo<{ key: string; type: string; description?: string }[]>(() => {

        if (!stageName || !settingsManager) {

            return [];

        }

        return settingsManager.getRequiredSecrets(stageName);

    }, [stageName, settingsManager]);

    // Find the secret definition to get description
    const secretDefinition = useMemo(() => {

        if (!secretKey) return null;

        return requiredSecrets.find((s) => s.key === secretKey);

    }, [secretKey, requiredSecrets]);

    // Check if this is a required secret
    const isRequired = useMemo(() => {

        return secretDefinition !== undefined;

    }, [secretDefinition]);

    // Check if secret exists in vault
    const existsInVault = useMemo(() => {

        if (!secretKey) return false;

        return vaultSecretKeys.includes(secretKey);

    }, [secretKey, vaultSecretKeys]);

    // Block deletion only if required AND not in vault
    // If it's in the vault, deleting local is fine (vault will provide value)
    const blockDeletion = isRequired && !existsInVault;

    // Check if secret exists locally
    const secretExists = useMemo(() => {

        if (!stateManager || !activeConfigName || !secretKey) return false;

        return stateManager.getSecret(activeConfigName, secretKey) !== null;

    }, [stateManager, activeConfigName, secretKey]);

    // Handle confirm
    const handleConfirm = useCallback(async () => {

        if (!stateManager || !activeConfigName || !secretKey) {

            showToast({ message: 'Secret not found', variant: 'error' });
            back();

            return;

        }

        setDeleting(true);

        const [, err] = await attempt(async () => {

            await stateManager.deleteSecret(activeConfigName, secretKey);
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

        // Success
        showToast({
            message: `Secret "${secretKey}" deleted`,
            variant: 'success',
        });
        back();

    }, [stateManager, activeConfigName, secretKey, refresh, showToast, back]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Keyboard handling for blocked/error states
    useInput((input, key) => {

        if (!isFocused) return;

        // Handle escape for error states
        if (!activeConfigName || !secretKey || !secretExists || blockDeletion) {

            if (key.escape || key.return) {

                back();

            }

        }

    });

    // No active config
    if (!activeConfigName || !activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Secret" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">No active configuration.</Text>
                        <Text>Set an active config first with: noorm config:use &lt;name&gt;</Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // No secret key provided
    if (!secretKey) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Secret" paddingX={2} paddingY={1} borderColor="yellow">
                    <Text color="yellow">
                        No secret key provided. Use: noorm secret:rm &lt;key&gt;
                    </Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Secret not found
    if (!secretExists) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Secret" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">Secret "{secretKey}" not found.</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Cannot delete required secret (unless it exists in vault)
    if (blockDeletion) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Secret" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">Cannot delete required secret "{secretKey}".</Text>
                        <Text>Required secrets are defined by the stage configuration.</Text>
                        <Text dimColor>
                            To remove a required secret definition, edit settings.yml
                        </Text>
                        <Text dimColor>
                            Or set this secret in the vault to allow local deletion.
                        </Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Deleting
    if (deleting) {

        return (
            <Panel title={`Delete: ${secretKey}`} paddingX={2} paddingY={1}>
                <Spinner label="Deleting secret..." />
            </Panel>
        );

    }

    // Confirmation
    return (
        <Panel title={`Delete: ${secretKey}`} paddingX={2} paddingY={1} borderColor="yellow">
            <Box flexDirection="column" gap={1}>
                <Text dimColor>Config: {activeConfigName}</Text>

                {/* Show description if available */}
                {secretDefinition?.description && (
                    <Box flexDirection="column">
                        <Text dimColor>Description:</Text>
                        <Text dimColor> {secretDefinition.description}</Text>
                    </Box>
                )}

                {/* Note when deleting required secret with vault backup */}
                {isRequired && existsInVault && (
                    <Text color="cyan">
                        This is a required secret but exists in the vault. The vault value will be used after deletion.
                    </Text>
                )}

                <Confirm
                    message={`Are you sure you want to delete secret "${secretKey}"?`}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    variant="warning"
                    isFocused={isFocused}
                />
            </Box>
        </Panel>
    );

}
