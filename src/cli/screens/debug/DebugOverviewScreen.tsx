/**
 * DebugOverviewScreen - noorm internal tables overview.
 *
 * Hidden debug screen accessible via easter egg (press ? 8 times within 3 seconds).
 * Shows counts of all noorm internal tables with navigation to drill down.
 *
 * Keyboard shortcuts:
 * - 1-5: Navigate to table list
 * - Esc: Go back
 *
 * WARNING: This is a debug feature for inspecting/modifying internal state.
 * Modifications may corrupt noorm state.
 */
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormTableName } from '../../../core/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner } from '../../components/index.js';
import { useConnection, useAsyncEffect } from '../../hooks/index.js';
import type { Kysely } from 'kysely';

import { type NoormDatabase } from '../../../core/index.js';
import {
    createDebugOperations,
    NOORM_TABLE_INFO,
    type TableCountResult,
} from '../../../core/debug/index.js';

/**
 * DebugOverviewScreen component.
 *
 * Entry point for debug mode, showing counts of all noorm internal tables.
 */
export function DebugOverviewScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('DebugOverview');
    const { activeConfig, activeConfigName } = useAppContext();

    const [counts, setCounts] = useState<TableCountResult[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Shared connection
    const { db, dialect, loading: connLoading, error: connError } = useConnection();

    // Load table counts when connection is ready
    useAsyncEffect(async (isCancelled) => {

        if (!db) {

            if (!connLoading && !connError) setIsLoading(false);

            return;

        }

        setIsLoading(true);
        setError(null);

        const [result, err] = await attempt(async () => {

            const ops = createDebugOperations(db as Kysely<NoormDatabase>, dialect ?? 'postgres');

            return await ops.getTableCounts();

        });

        if (isCancelled()) return;

        if (err) {

            setError(err.message);

        }
        else {

            setCounts(result);

        }

        setIsLoading(false);

    }, [db]);

    // Keyboard navigation
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        // Navigate by number key (1-5)
        const index = parseInt(input) - 1;

        if (index >= 0 && index < NOORM_TABLE_INFO.length) {

            const info = NOORM_TABLE_INFO[index];

            if (info) {

                navigate('debug/table', { table: info.name });

            }

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="DEBUG MODE" borderColor="red" paddingX={1} paddingY={1}>
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
                <Panel title="DEBUG MODE" borderColor="red" paddingX={1} paddingY={1}>
                    <Spinner label="Loading internal tables..." />
                </Panel>
            </Box>
        );

    }

    // Error state
    if (error || connError) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="DEBUG MODE" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Connection Error</Text>
                        <Text dimColor>{error ?? connError}</Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Get count for a table
    const getCount = (table: NoormTableName): number => {

        return counts.find((c) => c.table === table)?.count ?? 0;

    };

    // Calculate total rows
    const totalRows = counts.reduce((sum, c) => sum + c.count, 0);

    return (
        <Box flexDirection="column" gap={1}>
            {/* Warning banner */}
            <Panel title="DEBUG MODE" borderColor="red" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text color="yellow" bold>
                        Internal tables. Modifications may corrupt noorm state.
                    </Text>

                    {/* Config info */}
                    <Box gap={2} marginTop={1}>
                        <Text>Config:</Text>
                        <Text bold color="cyan">{activeConfigName}</Text>
                        <Text dimColor>({activeConfig.connection.dialect})</Text>
                    </Box>

                    <Box gap={2}>
                        <Text>Total Rows:</Text>
                        <Text bold color="green">{totalRows}</Text>
                    </Box>

                    {/* Table list */}
                    <Box marginTop={1} flexDirection="column">
                        {NOORM_TABLE_INFO.map((info, index) => {

                            const count = getCount(info.name);
                            const hasRows = count > 0;

                            return (
                                <Box key={info.key} gap={2}>
                                    <Text color={hasRows ? 'cyan' : 'gray'}>
                                        [{index + 1}]
                                    </Text>
                                    <Box width={14}>
                                        <Text color={hasRows ? undefined : 'gray'}>
                                            {info.displayName}
                                        </Text>
                                    </Box>
                                    <Box width={20}>
                                        <Text dimColor>{info.description}</Text>
                                    </Box>
                                    <Text bold={hasRows} color={hasRows ? 'green' : 'gray'}>
                                        {count} {count === 1 ? 'row' : 'rows'}
                                    </Text>
                                </Box>
                            );

                        })}
                    </Box>
                </Box>
            </Panel>

            {/* Hotkeys */}
            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[1-5] Select table</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
