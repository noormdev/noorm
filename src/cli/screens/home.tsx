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
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ScreenProps } from '../types.js';
import { useRouter } from '../router.js';
import { useFocusScope } from '../focus.js';
import { useAppContext } from '../app-context.js';
import { useShutdown } from '../shutdown.js';
import { Panel, Spinner } from '../components/index.js';
import { testConnection, createConnection } from '../../core/connection/factory.js';
import { ChangesetHistory } from '../../core/changeset/history.js';
import { discoverChangesets } from '../../core/changeset/parser.js';
import { getLockManager } from '../../core/lock/manager.js';
import type { ChangesetHistoryRecord } from '../../core/changeset/types.js';
import type { LockStatus } from '../../core/lock/types.js';
import type { NoormDatabase } from '../../core/shared/index.js';
import type { Kysely } from 'kysely';

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
    complete: boolean;
    missingSecrets: string[];
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
 * Format relative time for activity display.
 */
function formatRelativeTime(date: Date): string {

    const now = Date.now();
    const diff = now - date.getTime();

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;

    return 'just now';

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
        settingsManager,
        stateManager,
    } = useAppContext();

    const [status, setStatus] = useState<QuickStatus>({
        connection: 'none',
        pendingCount: null,
        lockStatus: null,
    });
    const [recentActivity, setRecentActivity] = useState<ChangesetHistoryRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Compute setup status for all configs
    const setupStatus = useMemo<ConfigSetupStatus[]>(() => {

        if (!settingsManager || !stateManager || !settings) {

            return [];

        }

        const stages = settings.stages ?? {};
        const results: ConfigSetupStatus[] = [];

        for (const config of configs) {

            // Check if config name matches a stage
            const stageName = stages[config.name] ? config.name : null;

            if (!stageName) {

                // Config not linked to a stage - skip
                continue;

            }

            // Get required secrets for this stage (universal + stage-specific)
            const requiredSecrets = settingsManager.getRequiredSecrets(stageName);

            // Get secrets that are set for this config
            const setSecrets = stateManager.listSecrets(config.name);
            const setSecretsSet: Record<string, boolean> = {};

            for (const key of setSecrets) {

                setSecretsSet[key] = true;

            }

            // Find missing secrets
            const missingSecrets = requiredSecrets
                .filter((s) => !setSecretsSet[s.key])
                .map((s) => s.key);

            results.push({
                configName: config.name,
                stageName,
                complete: missingSecrets.length === 0,
                missingSecrets,
            });

        }

        return results;

    }, [configs, settings, settingsManager, stateManager]);

    // Load status data when active config changes
    useEffect(() => {

        if (!activeConfig || loadingStatus !== 'ready') {

            setIsLoading(false);

            return;

        }

        let cancelled = false;

        const loadStatus = async () => {

            setIsLoading(true);
            setStatus((prev) => ({ ...prev, connection: 'checking' }));

            // Test connection
            const connResult = await testConnection(activeConfig.connection);

            if (cancelled) return;

            if (!connResult.ok) {

                const errorMsg = connResult.error ?? 'Connection failed';
                setStatus({
                    connection: isDatabaseMissingError(errorMsg) ? 'db-missing' : 'error',
                    connectionError: errorMsg,
                    pendingCount: null,
                    lockStatus: null,
                });
                setIsLoading(false);

                return;

            }

            // Connection successful - get more data
            const [result, err] = await attempt(async () => {

                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__status__',
                );
                const db = conn.db as Kysely<NoormDatabase>;

                if (cancelled) {

                    await conn.destroy();

                    return null;

                }

                // Get lock status
                const lockManager = getLockManager();
                const lockStatus = await lockManager.status(db, activeConfigName ?? '');

                // Get changeset info - use ChangesetHistory directly for read-only operations
                const changesetHistory = new ChangesetHistory(db, activeConfigName ?? '');

                // Discover changesets from disk
                const diskChangesets = await discoverChangesets(
                    activeConfig.paths.changesets,
                    activeConfig.paths.schema,
                );

                // Get statuses from DB
                const statuses = await changesetHistory.getAllStatuses();

                // Count pending (on disk but not applied, or reverted)
                let pendingCount = 0;
                for (const cs of diskChangesets) {

                    const status = statuses.get(cs.name);
                    if (!status || status.status === 'pending' || status.status === 'reverted') {

                        pendingCount++;

                    }

                }

                // Get recent activity
                const history = await changesetHistory.getHistory(undefined, 5);

                await conn.destroy();

                return { lockStatus, pendingCount, history };

            });

            if (err) {

                if (!cancelled) {

                    setStatus({
                        connection: 'error',
                        connectionError: err instanceof Error ? err.message : String(err),
                        pendingCount: null,
                        lockStatus: null,
                    });

                }

            }
            else if (result && !cancelled) {

                setStatus({
                    connection: 'connected',
                    pendingCount: result.pendingCount,
                    lockStatus: result.lockStatus,
                });
                setRecentActivity(result.history);

            }

            setIsLoading(false);

        };

        loadStatus();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, loadingStatus]);

    // Keyboard handling
    useInput((input, _key) => {

        if (!isFocused) return;

        // Quit gracefully
        if (input === 'q') {

            gracefulExit();

            return;

        }

        // Navigation shortcuts
        if (input === 'c') navigate('config');
        else if (input === 'g') navigate('change');
        else if (input === 'r') navigate('run');
        else if (input === 'd') navigate('db');
        else if (input === 'l') navigate('lock');
        else if (input === 's') navigate('settings');
        else if (input === 'k') navigate('secret');
        else if (input === 'i') navigate('identity');
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
                <Box gap={1}>
                    <Text color="yellow">●</Text>
                    <Text color="yellow">Success</Text>
                    {status.connectionError && (
                        <Text dimColor> ({status.connectionError.slice(0, 50)})</Text>
                    )}
                </Box>
            );

        case 'error':
            return (
                <Box gap={1}>
                    <Text color="red">●</Text>
                    <Text color="red">Error</Text>
                    {status.connectionError && (
                        <Text dimColor> ({status.connectionError.slice(0, 50)})</Text>
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
                    <Text dimColor> - Database Schema & Changeset Manager</Text>
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
                    <Text dimColor>[c]onfig [q]uit</Text>
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
                    <Text dimColor> - Database Schema & Changeset Manager</Text>
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
                    <Text dimColor>[c]onfig [q]uit</Text>
                </Box>
            </Box>
        );

    }

    return (
        <Box flexDirection="column" padding={1}>
            {/* Header */}
            <Box marginBottom={1}>
                <Text bold>noorm</Text>
                <Text dimColor> - Database Schema & Changeset Manager</Text>
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
                                        <Box key={s.configName} gap={1} marginLeft={2}>
                                            <Text color={s.complete ? 'green' : undefined}>
                                                {s.complete ? '✓' : ' '}
                                            </Text>
                                            <Text>{s.configName}</Text>
                                            {!s.complete && s.missingSecrets.length > 0 && (
                                                <Text color="red">
                                                    ✗ secrets ({s.missingSecrets.length})
                                                </Text>
                                            )}
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
                            <Box>
                                <Text color="cyan">[1]</Text>
                                <Text> Run Build</Text>
                            </Box>
                            <Box>
                                <Text color="cyan">[2]</Text>
                                <Text> Apply Changes (ff)</Text>
                            </Box>
                            <Box>
                                <Text color="cyan">[3]</Text>
                                <Text> View Lock Status</Text>
                            </Box>
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
                        {recentActivity.map((record) => (
                            <Box key={record.id} gap={1}>
                                <Text color={record.status === 'success' ? 'green' : 'red'}>
                                    {record.status === 'success' ? '✓' : '✗'}
                                </Text>
                                <Text color={record.direction === 'revert' ? 'yellow' : undefined}>
                                    {record.direction === 'revert' ? 'Reverted' : 'Applied'}
                                </Text>
                                <Text>{record.name}</Text>
                                <Text dimColor>{formatRelativeTime(record.executedAt)}</Text>
                            </Box>
                        ))}
                    </Box>
                )}
            </Panel>

            {/* Navigation Hints */}
            <Box marginTop={1}>
                <Text dimColor>
                    [c]onfig chan[g]e [r]un [d]b [l]ock [s]ettings [k]eys [i]dentity [q]uit
                </Text>
            </Box>
        </Box>
    );

}
