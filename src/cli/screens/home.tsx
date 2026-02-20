/**
 * Home screen - the main dashboard after initialization.
 *
 * Displays:
 * - Active config and connection status
 * - Quick status widgets (connection, pending, lock)
 * - Quick actions menu
 * - Recent activity
 *
 * @example
 * ```bash
 * noorm          # Opens home screen
 * noorm home     # Same thing
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ScreenProps } from '../types.js';
import { useRouter } from '../router.js';
import { useFocusScope } from '../focus.js';
import { useAppContext } from '../app-context.js';
import { useShutdown } from '../shutdown.js';
import { Panel, Spinner } from '../components/index.js';
import { useConnection, useAsyncEffect } from '../hooks/index.js';
import { getErrorMessage, resolveChangesDir, resolveSqlDir } from '../utils/index.js';
import { ChangeHistory } from '../../core/change/history.js';
import { discoverChanges } from '../../core/change/parser.js';
import { getLockManager } from '../../core/lock/manager.js';
import type { UnifiedHistoryRecord } from '../../core/change/types.js';
import type { LockStatus } from '../../core/lock/types.js';
import { relativeTimeAgo } from '../utils/date.js';

/**
 * Status for the quick status widget.
 */
interface QuickStatus {
    connection: 'checking' | 'connected' | 'db-missing' | 'error' | 'none';
    connectionError?: string;
    pendingCount: number | null;
    lockStatus: LockStatus | null;
}

/**
 * Setup status for a config.
 */
interface ConfigSetupStatus {
    configName: string;
    stageName: string | null;
}

/**
 * Check if an error indicates the database doesn't exist.
 */
function isDatabaseMissingError(error: string): boolean {

    const lower = error.toLowerCase();

    return (
        lower.includes('does not exist') ||
        lower.includes('unknown database') ||
        (lower.includes('database') && lower.includes('not found'))
    );

}

/**
 * Home screen component.
 *
 * Entry point for the TUI. Shows status and quick navigation.
 */
export function HomeScreen({ params: _params }: ScreenProps): ReactElement {

    const { gracefulExit } = useShutdown();
    const { navigate } = useRouter();
    const { isFocused } = useFocusScope('home');
    const {
        activeConfig,
        activeConfigName,
        configs,
        loadingStatus,
        hasIdentity,
        settings,
        projectRoot,
    } = useAppContext();

    const [status, setStatus] = useState<QuickStatus>({
        connection: 'none',
        pendingCount: null,
        lockStatus: null,
    });
    const [recentActivity, setRecentActivity] = useState<UnifiedHistoryRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Shared connection
    const { db, loading: connLoading, error: connError } = useConnection();

    // Compute setup status for all configs (configs linked to stages)
    const setupStatus = useMemo<ConfigSetupStatus[]>(() => {

        if (!settings) {

            return [];

        }

        const stages = settings.stages ?? {};

        return configs
            .filter((config) => stages[config.name])
            .map((config) => ({
                configName: config.name,
                stageName: config.name,
            }));

    }, [configs, settings]);

    // Load status data when connection is ready
    useAsyncEffect(async (isCancelled) => {

        if (loadingStatus !== 'ready') {

            setIsLoading(false);

            return;

        }

        if (connLoading) {

            setStatus((prev) => ({ ...prev, connection: 'checking' }));

            return;

        }

        if (connError) {

            const errorMsg = connError;
            setStatus({
                connection: isDatabaseMissingError(errorMsg) ? 'db-missing' : 'error',
                connectionError: errorMsg,
                pendingCount: null,
                lockStatus: null,
            });
            setIsLoading(false);

            return;

        }

        if (!db) {

            setIsLoading(false);

            return;

        }

        setIsLoading(true);

        const [result, err] = await attempt(async () => {

            // Get lock status
            const lockManager = getLockManager();
            const lockStatus = await lockManager.status(db, activeConfigName ?? '');

            // Get change info - use ChangeHistory directly for read-only operations
            const changeHistory = new ChangeHistory(db, activeConfigName ?? '');

            // Discover changes from disk
            const diskChanges = await discoverChanges(
                resolveChangesDir(projectRoot, settings),
                resolveSqlDir(projectRoot, settings),
            );

            // Get statuses from DB
            const statuses = await changeHistory.getAllStatuses();

            // Count pending (on disk but not applied, or reverted)
            let pendingCount = 0;
            for (const cs of diskChanges) {

                const status = statuses.get(cs.name);
                if (!status || status.status === 'pending' || status.status === 'reverted') {

                    pendingCount++;

                }

            }

            // Get recent activity (all operation types)
            const history = await changeHistory.getUnifiedHistory(undefined, 5);

            return { lockStatus, pendingCount, history };

        });

        if (err) {

            if (!isCancelled()) {

                setStatus({
                    connection: 'error',
                    connectionError: getErrorMessage(err),
                    pendingCount: null,
                    lockStatus: null,
                });

            }

        }
        else if (result && !isCancelled()) {

            setStatus({
                connection: 'connected',
                pendingCount: result.pendingCount,
                lockStatus: result.lockStatus,
            });
            setRecentActivity(result.history);

        }

        setIsLoading(false);

    }, [db, connLoading, connError, activeConfigName, loadingStatus, settings, projectRoot]);

    // Keyboard handling
    useInput((input, _key) => {

        if (!isFocused) return;

        // Quit gracefully
        if (input === 'q') {

            gracefulExit();

            return;

        }

        // Navigation shortcuts (main options)
        if (input === 'r') navigate('run');
        else if (input === 'c') navigate('config');
        else if (input === 'g') navigate('change');
        else if (input === 'd') navigate('db');
        else if (input === '+') navigate('more');
        // Secondary options (also accessible from More screen)
        else if (input === 's') navigate('settings');
        else if (input === 'v') navigate('vault');
        else if (input === 'i') navigate('identity');
        else if (input === 'l') navigate('lock');
        else if (input === 'u') navigate('update');
        // Number shortcuts for quick actions
        else if (input === '1') navigate('run/build');
        else if (input === '2') navigate('change/ff');
        else if (input === '3') navigate('lock/status');

    });

    // Render connection status indicator
    const renderConnectionStatus = useCallback(() => {

        switch (status.connection) {

        case 'checking':
            return <Spinner label="Checking..." />;

        case 'connected':
            return (
                <Box gap={1}>
                    <Text color="green">●</Text>
                    <Text>Connected</Text>
                </Box>
            );

        case 'db-missing':
            return (
                <Box flexDirection="column">
                    <Box gap={1}>
                        <Text color="yellow">●</Text>
                        <Text color="yellow">Success</Text>
                    </Box>
                    {status.connectionError && (
                        <Text dimColor wrap="truncate">  {status.connectionError}</Text>
                    )}
                </Box>
            );

        case 'error':
            return (
                <Box flexDirection="column">
                    <Box gap={1}>
                        <Text color="red">●</Text>
                        <Text color="red">Error</Text>
                    </Box>
                    {status.connectionError && (
                        <Text dimColor wrap="truncate">  {status.connectionError}</Text>
                    )}
                </Box>
            );

        default:
            return (
                <Box gap={1}>
                    <Text color="gray">○</Text>
                    <Text dimColor>Not connected</Text>
                </Box>
            );

        }

    }, [status]);

    // Render lock status
    const renderLockStatus = useCallback(() => {

        if (!status.lockStatus) {

            return <Text dimColor>-</Text>;

        }

        if (status.lockStatus.isLocked && status.lockStatus.lock) {

            return (
                <Box gap={1}>
                    <Text color="yellow">LOCKED</Text>
                    <Text dimColor>by {status.lockStatus.lock.lockedBy}</Text>
                </Box>
            );

        }

        return <Text color="green">FREE</Text>;

    }, [status.lockStatus]);

    // Render pending count
    const renderPendingCount = useCallback(() => {

        if (status.pendingCount === null) {

            return <Text dimColor>-</Text>;

        }

        if (status.pendingCount === 0) {

            return <Text color="green">0 pending</Text>;

        }

        return <Text color="yellow">{status.pendingCount} pending</Text>;

    }, [status.pendingCount]);

    // No configs prompt
    if (loadingStatus === 'ready' && configs.length === 0) {

        return (
            <Box flexDirection="column" padding={1}>
                <Box marginBottom={1}>
                    <Text bold>noorm</Text>
                    <Text dimColor> - Database Schema & Change Manager</Text>
                </Box>

                <Panel title="Welcome" paddingX={2} paddingY={1} borderColor="cyan">
                    <Box flexDirection="column" gap={1}>
                        <Text>Welcome to noorm!</Text>
                        <Text dimColor>No database configurations found.</Text>
                        <Box marginTop={1}>
                            <Text>Press </Text>
                            <Text color="cyan" bold>
                                [c]
                            </Text>
                            <Text> to create your first configuration.</Text>
                        </Box>
                    </Box>
                </Panel>

                <Box marginTop={1}>
                    <Text dimColor>[c] Config [q] Quit</Text>
                </Box>
            </Box>
        );

    }

    // No active config prompt
    if (loadingStatus === 'ready' && !activeConfig) {

        return (
            <Box flexDirection="column" padding={1}>
                <Box marginBottom={1}>
                    <Text bold>noorm</Text>
                    <Text dimColor> - Database Schema & Change Manager</Text>
                </Box>

                <Panel title="Select Config" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            You have <Text color="cyan">{configs.length}</Text> configuration(s),
                            but none is active.
                        </Text>
                        <Box marginTop={1}>
                            <Text>Press </Text>
                            <Text color="cyan" bold>
                                [c]
                            </Text>
                            <Text> to select a configuration to use.</Text>
                        </Box>
                    </Box>
                </Panel>

                <Box marginTop={1}>
                    <Text dimColor>[c] Config [q] Quit</Text>
                </Box>
            </Box>
        );

    }

    return (
        <Box flexDirection="column" padding={1}>
            {/* Header */}
            <Box marginBottom={1}>
                <Text bold>noorm</Text>
                <Text dimColor> - Database Schema & Change Manager</Text>
            </Box>

            {/* Welcome / Config Summary */}
            <Box marginBottom={1} gap={2}>
                <Text>Active Config: </Text>
                <Text color="cyan" bold>
                    {activeConfigName ?? 'none'}
                </Text>
                <Text dimColor>|</Text>
                <Text dimColor>Configs: {configs.length}</Text>
                {!hasIdentity && (
                    <>
                        <Text dimColor>|</Text>
                        <Text color="yellow">No identity (run init)</Text>
                    </>
                )}
            </Box>

            {/* Two-column layout for Status and Quick Actions */}
            <Box gap={2} marginBottom={1}>
                {/* Status Panel */}
                <Box flexDirection="column" flexGrow={1}>
                    <Panel title="Status" paddingX={2} paddingY={1}>
                        <Box flexDirection="column" gap={0}>
                            <Box gap={1}>
                                <Text dimColor>Connection:</Text>
                                {renderConnectionStatus()}
                            </Box>
                            <Box gap={1}>
                                <Text dimColor>Pending:</Text>
                                {isLoading ? <Spinner /> : renderPendingCount()}
                            </Box>
                            <Box gap={1}>
                                <Text dimColor>Lock:</Text>
                                {isLoading ? <Spinner /> : renderLockStatus()}
                            </Box>
                            {/* Stage setup status */}
                            {setupStatus.length > 0 && (
                                <>
                                    <Box marginTop={1}>
                                        <Text dimColor>Stage Configs:</Text>
                                    </Box>
                                    {setupStatus.map((s) => (
                                        <Box key={s.configName} marginLeft={2}>
                                            <Text>
                                                <Text color="green">✓</Text>
                                                {' '}{s.configName}
                                            </Text>
                                        </Box>
                                    ))}
                                </>
                            )}
                        </Box>
                    </Panel>
                </Box>

                {/* Quick Actions Panel */}
                <Box flexDirection="column" flexGrow={1}>
                    <Panel title="Quick Actions" paddingX={2} paddingY={1}>
                        <Box flexDirection="column" gap={0}>
                            <Text>
                                <Text color="cyan">[1]</Text> Run Build
                            </Text>
                            <Text>
                                <Text color="cyan">[2]</Text> Apply Changes (ff)
                            </Text>
                            <Text>
                                <Text color="cyan">[3]</Text> View Lock Status
                            </Text>
                        </Box>
                    </Panel>
                </Box>
            </Box>

            {/* Recent Activity Panel */}
            <Panel title="Recent Activity" paddingX={2} paddingY={1}>
                {isLoading ? (
                    <Spinner label="Loading activity..." />
                ) : recentActivity.length === 0 ? (
                    <Text dimColor>No recent activity</Text>
                ) : (
                    <Box flexDirection="column" gap={0}>
                        {recentActivity.map((record) => {

                            // Determine status indicator
                            const statusOk = record.status === 'success';
                            const statusColor = statusOk ? 'green' : 'red';
                            const statusIcon = statusOk ? '[OK]' : '[ERR]';

                            // Determine type indicator
                            let typeLabel: string;
                            let typeColor: string | undefined;

                            switch (record.changeType) {

                            case 'build':
                                typeLabel = '[BUILD]';
                                typeColor = 'blue';

                                break;

                            case 'run':
                                typeLabel = '[RUN]';
                                typeColor = 'magenta';

                                break;

                            case 'change':
                            default:
                                typeLabel = record.direction === 'revert' ? 'Reverted' : 'Applied';
                                typeColor = record.direction === 'revert' ? 'yellow' : undefined;

                                break;

                            }

                            // Format duration if available
                            const duration = record.durationMs
                                ? `(${(record.durationMs / 1000).toFixed(1)}s)`
                                : '';

                            return (
                                <Box key={record.id} gap={1}>
                                    <Text color={statusColor}>{statusIcon}</Text>
                                    <Text color={typeColor}>{typeLabel}</Text>
                                    <Text>{record.name}</Text>
                                    <Text dimColor>
                                        {relativeTimeAgo(record.executedAt)} {duration}
                                    </Text>
                                </Box>
                            );

                        })}
                    </Box>
                )}
            </Panel>

            {/* Navigation Hints */}
            <Box marginTop={1} flexWrap="wrap" columnGap={2}>
                <Text dimColor>[r] Run</Text>
                <Text dimColor>[c] Config</Text>
                <Text dimColor>[g] Change</Text>
                <Text dimColor>[d] DB</Text>
                <Text dimColor>[q] Quit</Text>
                <Text dimColor>[+] More</Text>
            </Box>
        </Box>
    );

}
