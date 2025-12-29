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
import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, ConnectionStatus } from '../../components/index.js';
import { createConnection, testConnection } from '../../../core/connection/index.js';
import { tablesExist } from '../../../core/version/index.js';
import { attempt } from '@logosdx/utils';

import type { NoormDatabase } from '../../../core/shared/index.js';
import type { Kysely } from 'kysely';

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

    const [status, setStatus] = useState<DbStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [_error, setError] = useState<string | null>(null);

    // Load database status
    useEffect(() => {

        if (!activeConfig) {

            setIsLoading(false);

            return;

        }

        let cancelled = false;

        const loadStatus = async () => {

            setIsLoading(true);
            setError(null);

            // Test connection first
            const testResult = await testConnection(activeConfig.connection);

            if (!testResult.ok) {

                if (!cancelled) {

                    setStatus({
                        connected: false,
                        connectionError: testResult.error,
                        tablesExist: false,
                        trackedCount: 0,
                    });
                    setIsLoading(false);

                }

                return;

            }

            // Connect and get details
            const [result, err] = await attempt(async () => {

                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? undefined,
                );
                const db = conn.db as Kysely<NoormDatabase>;

                // Check if tables exist
                const hasNoormTables = await tablesExist(db);

                let count = 0;

                if (hasNoormTables) {

                    // Count tracked objects (executions with unique file paths)
                    const executions = await db
                        .selectFrom('__noorm_executions__')
                        .select(db.fn.countAll<number>().as('count'))
                        .executeTakeFirst();

                    count = Number(executions?.count ?? 0);

                }

                await conn.destroy();

                return {
                    connected: true,
                    tablesExist: hasNoormTables,
                    trackedCount: count,
                };

            });

            if (cancelled) return;

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

        };

        loadStatus();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName]);

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

            navigate('db/create');

            return;

        }

        if (input === 'd') {

            navigate('db/destroy');

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

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading state
    if (isLoading) {

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
                        <Text color="cyan">[c]</Text> Create - Build database from SQL files
                    </Text>
                    <Text>
                        <Text color="cyan">[d]</Text> Destroy - Drop all managed objects
                    </Text>
                </Box>
            </Panel>

            <Box paddingX={1}>
                <Text color="yellow" dimColor>
                    Warning: These operations modify the database schema directly.
                </Text>
            </Box>

            <Box gap={2}>
                <Text dimColor>[c] Create</Text>
                <Text dimColor>[d] Destroy</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
