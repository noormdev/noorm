/**
 * LockListScreen - lock operations overview.
 *
 * Entry point for lock management showing:
 * - Active configuration
 * - Current lock status
 * - Available lock actions
 *
 * Keyboard shortcuts:
 * - s/1: Navigate to status screen
 * - a/2: Navigate to acquire screen
 * - r/3: Navigate to release screen
 * - f/4: Navigate to force-release screen
 * - Esc: Go back
 *
 * @example
 * ```bash
 * noorm lock           # Opens this screen
 * ```
 */
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, LockStatus, useToast } from '../../components/index.js';
import { useLockStatus } from '../../hooks/index.js';

/**
 * LockListScreen component.
 *
 * Shows lock status and available operations.
 */
export function LockListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('LockList');
    const { activeConfig, activeConfigName, identity: cryptoIdentity } = useAppContext();
    const { showToast } = useToast();

    const {
        status: lockStatus,
        identityStr,
        loading: isLoading,
        error: connectionError,
    } = useLockStatus(activeConfig, activeConfigName, cryptoIdentity);

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        // Only allow actions if we have an active config
        if (!activeConfig || connectionError) return;

        if (input === 's' || input === '1') {

            navigate('lock/status');

            return;

        }

        if (input === 'a' || input === '2') {

            // If already locked by us, show toast
            if (lockStatus?.isLocked && lockStatus.lock?.lockedBy === identityStr) {

                showToast({
                    message: 'You already hold this lock',
                    variant: 'info',
                });

                return;

            }

            navigate('lock/acquire');

            return;

        }

        if (input === 'r' || input === '3') {

            // If not locked or not ours, show toast
            if (!lockStatus?.isLocked) {

                showToast({
                    message: 'No lock to release',
                    variant: 'info',
                });

                return;

            }

            if (lockStatus.lock?.lockedBy !== identityStr) {

                showToast({
                    message: `Lock held by ${lockStatus.lock?.lockedBy}`,
                    variant: 'warning',
                });

                return;

            }

            navigate('lock/release');

            return;

        }

        if (input === 'f' || input === '4') {

            // If not locked, show toast
            if (!lockStatus?.isLocked) {

                showToast({
                    message: 'No lock to force-release',
                    variant: 'info',
                });

                return;

            }

            navigate('lock/force');

            return;

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Lock Management" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">No active configuration selected.</Text>
                        <Text dimColor>Select a configuration first using the config screen.</Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading state
    if (isLoading) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Lock Management" paddingX={1} paddingY={1}>
                    <Spinner label="Checking lock status..." />
                </Panel>
            </Box>
        );

    }

    // Connection error
    if (connectionError) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Lock Management" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Cannot connect to database</Text>
                        <Text dimColor>{connectionError}</Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Determine lock status display
    const getLockStatusType = (): 'free' | 'locked' | 'blocked' => {

        if (!lockStatus?.isLocked) return 'free';

        if (lockStatus.lock?.lockedBy === identityStr) return 'locked';

        return 'blocked';

    };

    const isOurLock = lockStatus?.isLocked && lockStatus.lock?.lockedBy === identityStr;

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Lock Management" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Box gap={2}>
                        <Text>Config:</Text>
                        <Text bold color="cyan">
                            {activeConfigName}
                        </Text>
                    </Box>

                    <Box gap={2}>
                        <Text>Your Identity:</Text>
                        <Text dimColor>{identityStr}</Text>
                    </Box>

                    <Box marginTop={1}>
                        <LockStatus
                            status={getLockStatusType()}
                            holder={lockStatus?.lock?.lockedBy}
                            since={lockStatus?.lock?.lockedAt}
                            expires={lockStatus?.lock?.expiresAt}
                        />
                    </Box>
                </Box>
            </Panel>

            <Panel title="Available Actions" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>
                        <Text color="cyan">[s]</Text> Status - View detailed lock information
                    </Text>
                    <Text>
                        <Text color="cyan">[a]</Text> Acquire - Obtain exclusive lock
                    </Text>
                    <Text color={isOurLock ? undefined : 'gray'}>
                        <Text color={isOurLock ? 'cyan' : 'gray'}>[r]</Text> Release - Release your
                        lock
                    </Text>
                    <Text color={lockStatus?.isLocked ? undefined : 'gray'}>
                        <Text color={lockStatus?.isLocked ? 'cyan' : 'gray'}>[f]</Text> Force -
                        Admin force-release
                    </Text>
                </Box>
            </Panel>

            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[s] Status</Text>
                <Text dimColor>[a] Acquire</Text>
                <Text dimColor>[r] Release</Text>
                <Text dimColor>[f] Force</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
