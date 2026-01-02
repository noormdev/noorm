/**
 * ChangeHistoryScreen - view execution history for all operation types.
 *
 * Shows unified history of changes, builds, and runs with drill-down
 * to file execution details.
 *
 * @example
 * ```bash
 * noorm change history     # View execution history
 * ```
 */
import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { UnifiedHistoryRecord } from '../../../core/change/types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';
import type { Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner } from '../../components/index.js';
import { ChangeHistory } from '../../../core/change/history.js';
import { createConnection } from '../../../core/connection/factory.js';
import { relativeTimeAgo } from '../../utils/date.js';

/**
 * Get type indicator for display.
 */
function getTypeIndicator(changeType: string): { label: string; color: string } {

    switch (changeType) {

    case 'build':
        return { label: '[BUILD]', color: 'blue' };

    case 'run':
        return { label: '[RUN]', color: 'magenta' };

    case 'change':
    default:
        return { label: '[CHANGESET]', color: 'cyan' };

    }

}

/**
 * ChangeHistoryScreen component.
 */
export function ChangeHistoryScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ChangeHistory');
    const { activeConfig, activeConfigName, loadingStatus } = useAppContext();

    const [history, setHistory] = useState<UnifiedHistoryRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Load history
    useEffect(() => {

        if (!activeConfig || loadingStatus !== 'ready') {

            setIsLoading(false);

            return;

        }

        let cancelled = false;

        const loadHistory = async () => {

            setIsLoading(true);
            setError(null);

            const [_, err] = await attempt(async () => {

                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__history__',
                );
                const db = conn.db as Kysely<NoormDatabase>;

                const changeHistory = new ChangeHistory(db, activeConfigName ?? '');
                const records = await changeHistory.getUnifiedHistory(undefined, 50);

                await conn.destroy();

                if (cancelled) return;

                setHistory(records);

            });

            if (err) {

                if (!cancelled) {

                    setError(err instanceof Error ? err.message : String(err));

                }

            }

            setIsLoading(false);

        };

        loadHistory();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, loadingStatus]);

    // Get selected record
    const selectedRecord = useMemo(() => {

        return history[selectedIndex];

    }, [history, selectedIndex]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        // Navigation
        if (key.upArrow) {

            setSelectedIndex((prev) => Math.max(0, prev - 1));

            return;

        }

        if (key.downArrow) {

            setSelectedIndex((prev) => Math.min(history.length - 1, prev + 1));

            return;

        }

        if (key.escape) {

            back();

            return;

        }

        // Enter - view file details
        if (key.return && selectedRecord) {

            navigate('change/history/detail', {
                operationId: selectedRecord.id,
                name: selectedRecord.name,
            });

            return;

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Execution History" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration. Press 'c' to manage configs.</Text>
            </Panel>
        );

    }

    // Loading
    if (isLoading) {

        return (
            <Panel title="Execution History" paddingX={2} paddingY={1}>
                <Spinner label="Loading history..." />
            </Panel>
        );

    }

    // Error
    if (error) {

        return (
            <Panel title="Execution History" paddingX={2} paddingY={1} borderColor="red">
                <Box flexDirection="column" gap={1}>
                    <Text color="red">Failed to load history: {error}</Text>
                    <Text dimColor>Press Esc to go back</Text>
                </Box>
            </Panel>
        );

    }

    // Statistics
    const totalChanges = history.filter((r) => r.changeType === 'change').length;
    const totalBuilds = history.filter((r) => r.changeType === 'build').length;
    const totalRuns = history.filter((r) => r.changeType === 'run').length;
    const totalSuccess = history.filter((r) => r.status === 'success').length;
    const totalFailed = history.filter((r) => r.status === 'failed').length;

    return (
        <Panel title="Execution History" paddingX={2} paddingY={1}>
            <Box flexDirection="column" gap={1}>
                {/* Statistics */}
                <Box gap={2} flexWrap="wrap">
                    <Text>
                        Total: <Text bold>{history.length}</Text>
                    </Text>
                    <Text>
                        Changes: <Text color="cyan">{totalChanges}</Text>
                    </Text>
                    <Text>
                        Builds: <Text color="blue">{totalBuilds}</Text>
                    </Text>
                    <Text>
                        Runs: <Text color="magenta">{totalRuns}</Text>
                    </Text>
                    <Text>
                        Success: <Text color="green">{totalSuccess}</Text>
                    </Text>
                    {totalFailed > 0 && (
                        <Text>
                            Failed: <Text color="red">{totalFailed}</Text>
                        </Text>
                    )}
                </Box>

                {/* History List */}
                {history.length === 0 ? (
                    <Box marginTop={1}>
                        <Text dimColor>No execution history found.</Text>
                    </Box>
                ) : (
                    <Box flexDirection="column" marginTop={1}>
                        {history.slice(0, 15).map((record, index) => {

                            const isSelected = index === selectedIndex;
                            const typeIndicator = getTypeIndicator(record.changeType);
                            const statusOk = record.status === 'success';
                            const statusColor = statusOk ? 'green' : 'red';
                            const statusIcon = statusOk ? '[OK]' : '[ERR]';
                            const duration = record.durationMs
                                ? `(${(record.durationMs / 1000).toFixed(1)}s)`
                                : '';

                            return (
                                <Box key={record.id}>
                                    <Text color={isSelected ? 'cyan' : undefined}>
                                        {isSelected ? '>' : ' '}
                                    </Text>
                                    <Text color={statusColor}> {statusIcon} </Text>
                                    <Text color={typeIndicator.color}>{typeIndicator.label} </Text>
                                    <Text
                                        color={isSelected ? 'cyan' : undefined}
                                        bold={isSelected}
                                    >
                                        {record.name}
                                    </Text>
                                    <Text dimColor>
                                        {' '}
                                        {relativeTimeAgo(record.executedAt)} {duration}
                                    </Text>
                                </Box>
                            );

                        })}
                        {history.length > 15 && (
                            <Text dimColor>
                                ...and {history.length - 15} more
                            </Text>
                        )}
                    </Box>
                )}

                {/* Selected record details */}
                {selectedRecord && (
                    <Box
                        marginTop={1}
                        flexDirection="column"
                        borderStyle="single"
                        borderColor="gray"
                        paddingX={1}
                    >
                        <Text bold>{selectedRecord.name}</Text>
                        <Box gap={2}>
                            <Text dimColor>
                                By: {selectedRecord.executedBy}
                            </Text>
                            <Text dimColor>
                                Duration: {(selectedRecord.durationMs / 1000).toFixed(2)}s
                            </Text>
                        </Box>
                        {selectedRecord.status === 'failed' && selectedRecord.errorMessage && (
                            <Text color="red">
                                Error: {selectedRecord.errorMessage.slice(0, 80)}
                                {selectedRecord.errorMessage.length > 80 ? '...' : ''}
                            </Text>
                        )}
                        <Text dimColor>Press Enter to view file details</Text>
                    </Box>
                )}

                {/* Keyboard hints */}
                <Box marginTop={1} gap={2}>
                    <Text dimColor>[Enter] View Files</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        </Panel>
    );

}
