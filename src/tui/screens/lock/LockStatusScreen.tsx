/**
 * LockStatusScreen - detailed lock status view.
 *
 * Shows comprehensive lock information including:
 * - Lock holder identity
 * - Acquisition time
 * - Expiration time
 * - Reason (if provided)
 *
 * Keyboard shortcuts:
 * - a: Acquire lock (if free)
 * - r: Release lock (if yours)
 * - x: Extend lock (if yours)
 * - f: Force-release (admin)
 * - Esc: Go back
 *
 * @example
 * ```bash
 * noorm lock:status    # Opens this screen
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
 * Format duration for display.
 */
function formatDuration(ms: number): string {

    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {

        return `${hours}h ${minutes % 60}m`;

    }

    return `${minutes}m`;

}

/**
 * LockStatusScreen component.
 *
 * Shows detailed lock status with contextual actions.
 */
export function LockStatusScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('LockStatus');
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

        // Only allow actions if we have an active config and connection
        if (!activeConfig || connectionError) return;

        if (input === 'a') {

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

        if (input === 'r') {

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

        if (input === 'x') {

            if (!lockStatus?.isLocked) {

                showToast({
                    message: 'No lock to extend',
                    variant: 'info',
                });

                return;

            }

            if (lockStatus.lock?.lockedBy !== identityStr) {

                showToast({
                    message: `Cannot extend - lock held by ${lockStatus.lock?.lockedBy}`,
                    variant: 'warning',
                });

                return;

            }

            // Re-acquire to extend
            navigate('lock/acquire');

            return;

        }

        if (input === 'f') {

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
                <Panel title="Lock Status" borderColor="yellow" paddingX={1} paddingY={1}>
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
                <Panel title="Lock Status" paddingX={1} paddingY={1}>
                    <Spinner label="Checking lock status..." />
                </Panel>
            </Box>
        );

    }

    // Connection error
    if (connectionError) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Lock Status" borderColor="red" paddingX={1} paddingY={1}>
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

    // Determine lock status
    const isOurLock = lockStatus?.isLocked && lockStatus.lock?.lockedBy === identityStr;
    const statusType: 'free' | 'locked' | 'blocked' = !lockStatus?.isLocked
        ? 'free'
        : isOurLock
            ? 'locked'
            : 'blocked';

    // Calculate time remaining
    const timeRemaining =
        lockStatus?.lock?.expiresAt && lockStatus.isLocked
            ? lockStatus.lock.expiresAt.getTime() - Date.now()
            : 0;

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Lock Status" paddingX={1} paddingY={1}>
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
                            status={statusType}
                            holder={lockStatus?.lock?.lockedBy}
                            since={lockStatus?.lock?.lockedAt}
                            expires={lockStatus?.lock?.expiresAt}
                        />
                    </Box>

                    {lockStatus?.isLocked && lockStatus.lock?.reason && (
                        <Box gap={2} marginTop={1}>
                            <Text dimColor>Reason:</Text>
                            <Text>{lockStatus.lock.reason}</Text>
                        </Box>
                    )}

                    {lockStatus?.isLocked && timeRemaining > 0 && (
                        <Box gap={2}>
                            <Text dimColor>Time Remaining:</Text>
                            <Text color={timeRemaining < 60000 ? 'yellow' : undefined}>
                                {formatDuration(timeRemaining)}
                            </Text>
                        </Box>
                    )}
                </Box>
            </Panel>

            {/* Contextual actions based on lock state */}
            {!lockStatus?.isLocked && (
                <Panel title="Actions" borderColor="green" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="green">Database is unlocked and available.</Text>
                        <Text>
                            Press <Text color="cyan">[a]</Text> to acquire the lock.
                        </Text>
                    </Box>
                </Panel>
            )}

            {isOurLock && (
                <Panel title="Actions" borderColor="blue" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="blue">You hold this lock.</Text>
                        <Text>
                            Press <Text color="cyan">[r]</Text> to release or{' '}
                            <Text color="cyan">[x]</Text> to extend.
                        </Text>
                    </Box>
                </Panel>
            )}

            {lockStatus?.isLocked && !isOurLock && (
                <Panel title="Actions" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">Blocked by another user.</Text>
                        <Text dimColor>
                            Wait for lock to be released, or use <Text color="cyan">[f]</Text> for
                            emergency force-release.
                        </Text>
                    </Box>
                </Panel>
            )}

            <Box flexWrap="wrap" columnGap={2}>
                {!lockStatus?.isLocked && <Text dimColor>[a] Acquire</Text>}
                {isOurLock && (
                    <>
                        <Text dimColor>[r] Release</Text>
                        <Text dimColor>[x] Extend</Text>
                    </>
                )}
                {lockStatus?.isLocked && <Text dimColor>[f] Force</Text>}
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
