/**
 * SQL History Screen.
 *
 * Browse and manage SQL query history.
 *
 * Features:
 * - Browse past queries with metadata
 * - Re-run queries with [r]
 * - View results for successful queries
 * - Clear history (3 months or all)
 *
 * @example
 * ```bash
 * # Press [h] from SQL Terminal
 * ```
 */
import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { SqlHistoryEntry, SqlExecutionResult } from '../../../core/sql-terminal/types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, useToast } from '../../components/index.js';
import { ResultTable } from '../../components/terminal/index.js';
import { SqlHistoryManager } from '../../../core/sql-terminal/index.js';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';

dayjs.extend(relativeTime);

/**
 * Format duration for display.
 */
function formatDuration(ms: number): string {

    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;

    return `${(ms / 60000).toFixed(1)}m`;

}

/**
 * Truncate SQL for display.
 */
function truncateSql(sql: string, maxLen: number): string {

    const oneLine = sql.replace(/\s+/g, ' ').trim();

    if (oneLine.length <= maxLen) return oneLine;

    return oneLine.slice(0, maxLen - 3) + '...';

}

/**
 * SQL History Screen component.
 */
export function SqlHistoryScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('SqlHistory');
    const { activeConfigName, projectRoot } = useAppContext();
    const { showToast } = useToast();

    // State
    const [history, setHistory] = useState<SqlHistoryEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const [selectedResult, setSelectedResult] = useState<SqlExecutionResult | null>(null);
    const [loadingResult, setLoadingResult] = useState(false);

    const maxVisibleRows = 10;

    // Load history
    useEffect(() => {

        if (!activeConfigName || !projectRoot) {

            setIsLoading(false);

            return;

        }

        const loadHistory = async () => {

            setIsLoading(true);

            const manager = new SqlHistoryManager(projectRoot, activeConfigName);
            const entries = await manager.load();

            setHistory(entries);
            setIsLoading(false);

        };

        loadHistory();

    }, [activeConfigName, projectRoot]);

    // Visible entries
    const visibleEntries = useMemo(() => {

        return history.slice(scrollOffset, scrollOffset + maxVisibleRows);

    }, [history, scrollOffset]);

    // Load result for selected entry
    const loadResult = async (entry: SqlHistoryEntry) => {

        if (!entry.resultsFile || !projectRoot || !activeConfigName) return;

        setLoadingResult(true);

        const manager = new SqlHistoryManager(projectRoot, activeConfigName);
        const result = await manager.loadResults(entry.id);

        setSelectedResult(result);
        setLoadingResult(false);

    };

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused) return;

        // Viewing result - Escape to close
        if (selectedResult) {

            if (key.escape) {

                setSelectedResult(null);

            }

            return;

        }

        // Up: Navigate up
        if (key.upArrow) {

            if (highlightedIndex > 0) {

                setHighlightedIndex((i) => i - 1);

                if (highlightedIndex - 1 < scrollOffset) {

                    setScrollOffset((o) => Math.max(0, o - 1));

                }

            }

            return;

        }

        // Down: Navigate down
        if (key.downArrow) {

            if (highlightedIndex < history.length - 1) {

                setHighlightedIndex((i) => i + 1);

                if (highlightedIndex + 1 >= scrollOffset + maxVisibleRows) {

                    setScrollOffset((o) => o + 1);

                }

            }

            return;

        }

        // r: Re-run selected query
        if (input === 'r') {

            const entry = history[highlightedIndex];

            if (entry) {

                // Navigate back to terminal with query pre-filled
                navigate('db/sql', { name: entry.query });

            }

            return;

        }

        // Enter: View result
        if (key.return) {

            const entry = history[highlightedIndex];

            if (entry?.resultsFile) {

                loadResult(entry);

            }
            else if (entry && !entry.success) {

                showToast({
                    message: entry.errorMessage ?? 'Query failed',
                    variant: 'error',
                });

            }
            else {

                showToast({
                    message: 'No results stored for this query',
                    variant: 'info',
                });

            }

            return;

        }

        // c: Clear menu
        if (input === 'c') {

            navigate('db/sql/clear');

            return;

        }

        // Escape: Back
        if (key.escape) {

            back();

            return;

        }

    });

    // No config
    if (!activeConfigName || !projectRoot) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="SQL History" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Text color="yellow">No active configuration selected.</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading
    if (isLoading) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="SQL History" paddingX={1} paddingY={1}>
                    <Spinner label="Loading history..." />
                </Panel>
            </Box>
        );

    }

    // Viewing result
    if (selectedResult) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Query Result" paddingX={1} paddingY={1}>
                    {selectedResult.columns && selectedResult.rows ? (
                        <ResultTable
                            columns={selectedResult.columns}
                            rows={selectedResult.rows}
                            active={true}
                        />
                    ) : (
                        <Text dimColor>No data</Text>
                    )}
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Close</Text>
                </Box>
            </Box>
        );

    }

    // Loading result
    if (loadingResult) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="SQL History" paddingX={1} paddingY={1}>
                    <Spinner label="Loading result..." />
                </Panel>
            </Box>
        );

    }

    // Empty history
    if (history.length === 0) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="SQL History" paddingX={1} paddingY={1}>
                    <Text dimColor>No query history yet.</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    return (
        <Box flexDirection="column" gap={1}>
            {/* Header */}
            <Box gap={2}>
                <Text bold>SQL History</Text>
                <Text dimColor>-</Text>
                <Text color="cyan">{activeConfigName}</Text>
                <Text dimColor>|</Text>
                <Text dimColor>{history.length} queries</Text>
            </Box>

            {/* History list */}
            <Panel title="Queries" paddingX={1} paddingY={1}>
                <Box flexDirection="column">
                    {/* Scroll indicator (up) */}
                    {scrollOffset > 0 && (
                        <Text dimColor>↑ {scrollOffset} more above</Text>
                    )}

                    {visibleEntries.map((entry, index) => {

                        const actualIndex = scrollOffset + index;
                        const isHighlighted = actualIndex === highlightedIndex;

                        return (
                            <Box
                                key={entry.id}
                                flexDirection="column"
                                paddingY={0}
                            >
                                <Box>
                                    <Text inverse={isHighlighted}>
                                        {isHighlighted ? '> ' : '  '}
                                    </Text>
                                    <Text
                                        inverse={isHighlighted}
                                        color={entry.success ? undefined : 'red'}
                                    >
                                        {truncateSql(entry.query, 60)}
                                    </Text>
                                </Box>
                                <Box marginLeft={2} gap={1}>
                                    <Text dimColor>
                                        {dayjs(entry.executedAt).fromNow()}
                                    </Text>
                                    <Text dimColor>|</Text>
                                    <Text dimColor>
                                        {formatDuration(entry.durationMs)}
                                    </Text>
                                    <Text dimColor>|</Text>
                                    <Text color={entry.success ? 'green' : 'red'}>
                                        {entry.success ? 'OK' : 'ERR'}
                                    </Text>
                                    {entry.rowCount !== undefined && (
                                        <>
                                            <Text dimColor>|</Text>
                                            <Text dimColor>{entry.rowCount} rows</Text>
                                        </>
                                    )}
                                </Box>
                            </Box>
                        );

                    })}

                    {/* Scroll indicator (down) */}
                    {scrollOffset + maxVisibleRows < history.length && (
                        <Text dimColor>
                            ↓ {history.length - scrollOffset - maxVisibleRows} more below
                        </Text>
                    )}
                </Box>
            </Panel>

            {/* Selected query preview */}
            {history[highlightedIndex] && (
                <Panel title="Query" paddingX={1} paddingY={1}>
                    <Text wrap="wrap">{history[highlightedIndex].query}</Text>
                </Panel>
            )}

            {/* Footer hints */}
            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[r] Re-run</Text>
                <Text dimColor>[Enter] View result</Text>
                <Text dimColor>[c] Clear</Text>
                <Text dimColor>[↑/↓] Navigate</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
