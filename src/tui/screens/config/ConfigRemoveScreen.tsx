/**
 * ConfigRemoveScreen - delete a database configuration.
 *
 * Requires confirmation before deletion.
 * Protected configs require typed confirmation.
 * Cannot delete the active configuration.
 *
 * @example
 * ```bash
 * noorm config:rm dev      # Delete 'dev' config
 * noorm config rm dev      # Same thing
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Confirm, ProtectedConfirm, Spinner, useToast, MissingParamPanel, NotFoundPanel } from '../../components/index.js';
import { checkConfigPolicy, confirmationPhraseFor } from '../../../core/policy/index.js';
import { getErrorMessage } from '../../utils/index.js';

/**
 * ConfigRemoveScreen component.
 */
export function ConfigRemoveScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('ConfigRemove');
    const { stateManager, activeConfigName, refresh } = useAppContext();
    const { showToast } = useToast();

    const configName = params.name;

    const [deleting, setDeleting] = useState(false);

    // Get the config
    const config = useMemo(() => {

        if (!stateManager || !configName) return null;

        return stateManager.getConfig(configName);

    }, [stateManager, configName]);

    // Check if this is the active config
    const isActive = configName === activeConfigName;

    // Policy check for the config:rm permission
    const check = config ? checkConfigPolicy('user', config, 'config:rm') : null;

    // Handle confirm
    const handleConfirm = useCallback(async () => {

        if (!stateManager || !configName) {

            showToast({ message: 'Config not found', variant: 'error' });
            back();

            return;

        }

        setDeleting(true);

        const [_, err] = await attempt(async () => {

            await stateManager.deleteConfig(configName);
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

        // Success - show toast and go back (pops history)
        showToast({
            message: `Configuration "${configName}" deleted`,
            variant: 'success',
        });
        back();

    }, [stateManager, configName, refresh, showToast, back]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Keyboard handling for blocked/error states
    useInput((input, key) => {

        if (!isFocused) return;

        // Handle escape for error states (no config, not found, active config, denied)
        if (!configName || !config || isActive || (check && !check.allowed)) {

            if (key.escape || key.return) {

                back();

            }

        }

    });

    // No config name provided
    if (!configName) {

        return <MissingParamPanel title="Delete Configuration" param="config name" usage="noorm config:rm <name>" />;

    }

    // Config not found
    if (!config) {

        return <NotFoundPanel title="Delete Configuration" type="Config" name={configName} />;

    }

    // Cannot delete active config
    if (isActive) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Configuration" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">Cannot delete the active configuration.</Text>
                        <Text>
                            Switch to a different config first with: noorm config:use &lt;name&gt;
                        </Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Denied by policy (viewer role)
    if (check && !check.allowed) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Configuration" paddingX={2} paddingY={1} borderColor="red">
                    <Text color="red">{check.blockedReason}</Text>
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
            <Panel title={`Delete: ${configName}`} paddingX={2} paddingY={1}>
                <Spinner label="Deleting configuration..." />
            </Panel>
        );

    }

    // Confirmation step - type-to-confirm when config:rm requires it
    // (operator/admin both confirm per the matrix, unless NOORM_YES is set)
    if (check?.requiresConfirmation) {

        return (
            <ProtectedConfirm
                configName={configName}
                confirmPhrase={check.confirmationPhrase ?? confirmationPhraseFor(configName)}
                action="delete"
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                isFocused={isFocused}
            />
        );

    }

    // Regular confirmation
    return (
        <Panel title={`Delete: ${configName}`} paddingX={2} paddingY={1} borderColor="yellow">
            <Confirm
                message={`Are you sure you want to delete configuration "${configName}"?`}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                variant="warning"
                isFocused={isFocused}
            />
        </Panel>
    );

}
