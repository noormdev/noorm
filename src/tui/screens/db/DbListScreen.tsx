/**
 * DbListScreen - database operations overview.
 *
 * Entry point for database lifecycle management showing:
 * - Active configuration
 * - Connection status
 * - Count of tracked objects
 *
 * Keyboard shortcuts:
 * - c: Navigate to create screen
 * - d: Navigate to destroy screen
 * - Esc: Go back
 *
 * @example
 * ```bash
 * noorm db           # Opens this screen
 * ```
 */
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, ConnectionStatus, isDatabaseNotFoundError, useToast } from '../../components/index.js';
import { useConnection, useAsyncEffect } from '../../hooks/index.js';
import { tablesExist } from '../../../core/version/index.js';
import { getNoormTables, noormDb } from '../../../core/shared/index.js';
import { attempt } from '@logosdx/utils';

/**
 * Database status information.
 */
interface DbStatus {
    /** Whether connection was successful */
    connected: boolean;

    /** Connection error message if failed */
    connectionError?: string;

    /** Whether noorm tables exist in the database */
    tablesExist: boolean;

    /** Count of tracked objects */
    trackedCount: number;
}

/**
 * DbListScreen component.
 *
 * Shows database status and available operations.
 */
export function DbListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('DbList');
    const { activeConfig, activeConfigName } = useAppContext();
    const { showToast } = useToast();

    const [status, setStatus] = useState<DbStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [_error, setError] = useState<string | null>(null);

    // Shared connection
    const { db, dialect, loading: connLoading, error: connError } = useConnection();

    // Load database status when connection is ready
    useAsyncEffect(async (isCancelled) => {

        if (connError) {

            setStatus({
                connected: false,
                connectionError: connError,
                tablesExist: false,
                trackedCount: 0,
            });
            setIsLoading(false);

            return;

        }

        if (!db) {

            if (!connLoading) setIsLoading(false);

            return;

        }

        setIsLoading(true);
        setError(null);

        const [result, err] = await attempt(async () => {

            // Check if tables exist
            const connDialect = dialect ?? 'postgres';
            const hasNoormTables = await tablesExist(db, connDialect);

            let count = 0;

            if (hasNoormTables) {

                // Count tracked objects (executions with unique file paths)
                const tables = getNoormTables(connDialect);
                const ndb = noormDb(db, connDialect);
                const executions = await ndb
                    .selectFrom(tables.executions as never)
                    .select(ndb.fn.countAll<number>().as('count'))
                    .executeTakeFirst();

                count = Number(executions?.count ?? 0);

            }

            return {
                connected: true,
                tablesExist: hasNoormTables,
                trackedCount: count,
            };

        });

        if (isCancelled()) return;

        if (err) {

            setStatus({
                connected: false,
                connectionError: err.message,
                tablesExist: false,
                trackedCount: 0,
            });

        }
        else if (result) {

            setStatus(result);

        }

        setIsLoading(false);

    }, [db, connLoading, connError]);

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        // Only allow actions if we have an active config
        if (!activeConfig) return;

        if (input === 'c') {

            // Already initialized - show toast instead of navigating
            if (status?.connected && status?.tablesExist) {

                showToast({
                    message: `Database "${activeConfig.connection.database}" already initialized`,
                    variant: 'info',
                });

                return;

            }

            navigate('db/create');

            return;

        }

        if (input === 'd') {

            navigate('db/destroy');

            return;

        }

        if (input === 'x') {

            // Only allow explore if connected
            if (!status?.connected) return;

            navigate('db/explore');

            return;

        }

        if (input === 'w') {

            // Only allow wipe if connected
            if (!status?.connected) return;

            navigate('db/truncate');

            return;

        }

        if (input === 't') {

            // Only allow teardown if connected
            if (!status?.connected) return;

            navigate('db/teardown');

            return;

        }

        if (input === 'r') {

            // Only allow transfer if connected
            if (!status?.connected) return;

            navigate('db/transfer');

            return;

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Database Operations" borderColor="yellow" paddingX={1} paddingY={1}>
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
    if (isLoading || connLoading) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Database Operations" paddingX={1} paddingY={1}>
                    <Spinner label="Checking database status..." />
                </Panel>
            </Box>
        );

    }

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Database Operations" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Box gap={2}>
                        <Text>Config:</Text>
                        <Text bold color="cyan">
                            {activeConfigName}
                        </Text>
                    </Box>

                    <Box gap={2}>
                        <Text>Connection:</Text>
                        {status?.connected ? (
                            <ConnectionStatus status="connected" />
                        ) : isDatabaseNotFoundError(status?.connectionError) ? (
                            <ConnectionStatus status="no-database" />
                        ) : (
                            <Box flexDirection="column">
                                <ConnectionStatus status="error" />
                                {status?.connectionError && (
                                    <Text color="red" dimColor>
                                        {' '}
                                        {status.connectionError}
                                    </Text>
                                )}
                            </Box>
                        )}
                    </Box>

                    {status?.connected && (
                        <>
                            <Box gap={2}>
                                <Text>Tracking Tables:</Text>
                                {status.tablesExist ? (
                                    <Text color="green">Initialized</Text>
                                ) : (
                                    <Text color="yellow">Not initialized</Text>
                                )}
                            </Box>

                            <Box gap={2}>
                                <Text>Tracked Executions:</Text>
                                <Text bold>{status.trackedCount}</Text>
                            </Box>
                        </>
                    )}
                </Box>
            </Panel>

            <Panel title="Available Actions" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>
                        <Text color="cyan">[c]</Text> Create - Create database and tracking tables
                    </Text>
                    <Text>
                        <Text color="cyan">[d]</Text> Destroy - Drop all managed objects
                    </Text>
                    <Text color={status?.connected ? undefined : 'gray'}>
                        <Text color={status?.connected ? 'cyan' : 'gray'}>[x]</Text> Explore - Browse database schema
                    </Text>
                    <Text color={status?.connected ? undefined : 'gray'}>
                        <Text color={status?.connected ? 'cyan' : 'gray'}>[w]</Text> Wipe - Truncate table data (keep schema)
                    </Text>
                    <Text color={status?.connected ? undefined : 'gray'}>
                        <Text color={status?.connected ? 'cyan' : 'gray'}>[t]</Text> Teardown - Drop user objects (keep noorm)
                    </Text>
                    <Text color={status?.connected ? undefined : 'gray'}>
                        <Text color={status?.connected ? 'cyan' : 'gray'}>[r]</Text> Transfer - Copy data to another database
                    </Text>
                </Box>
            </Panel>

            <Box paddingX={1}>
                <Text color="yellow" dimColor>
                    Warning: These operations modify the database directly.
                </Text>
            </Box>

            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[c] Create</Text>
                <Text dimColor>[d] Destroy</Text>
                <Text dimColor>[x] Explore</Text>
                <Text dimColor>[w] Wipe</Text>
                <Text dimColor>[t] Teardown</Text>
                <Text dimColor>[r] Transfer</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
