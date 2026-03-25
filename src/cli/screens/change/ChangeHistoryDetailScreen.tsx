/**
 * ChangeHistoryDetailScreen - view file executions for an operation.
 *
 * Shows all files executed as part of a build, run, or change
 * with their individual status, duration, and errors.
 *
 * @example
 * ```bash
 * # Navigate from ChangeHistoryScreen by pressing Enter
 * ```
 */
import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { FileHistoryRecord } from '../../../core/change/types.js';

import { attempt } from '@logosdx/utils';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner } from '../../components/index.js';
import { useConnection, useAsyncEffect } from '../../hooks/index.js';
import { ChangeHistory } from '../../../core/change/history.js';
import { getErrorMessage } from '../../utils/index.js';

/**
 * Get status indicator for a file execution.
 */
function getStatusIndicator(status: string): { icon: string; color: string } {

    switch (status) {

    case 'success':
        return { icon: '[OK]', color: 'green' };

    case 'failed':
        return { icon: '[ERR]', color: 'red' };

    case 'skipped':
        return { icon: '[-]', color: 'yellow' };

    case 'pending':
    default:
        return { icon: '[...]', color: 'gray' };

    }

}

/**
 * Extract filename from path.
 */
function getFilename(filepath: string): string {

    return filepath.split('/').pop() ?? filepath;

}

/**
 * ChangeHistoryDetailScreen component.
 */
export function ChangeHistoryDetailScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('ChangeHistoryDetail');
    const { activeConfig, activeConfigName, loadingStatus } = useAppContext();

    const operationId = params.operationId;
    const operationName = params.name ?? 'Operation';

    const [files, setFiles] = useState<FileHistoryRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Shared connection
    const { db, dialect, loading: connLoading, error: connError } = useConnection();

    // Load file history when connection is ready
    useAsyncEffect(async (isCancelled) => {

        if (!db || loadingStatus !== 'ready' || !operationId) {

            if (!connLoading && !connError) setIsLoading(false);

            return;

        }

        setIsLoading(true);
        setError(null);

        const [_, err] = await attempt(async () => {

            const changeHistory = new ChangeHistory(db, activeConfigName ?? '', dialect ?? 'postgres');
            const records = await changeHistory.getFileHistory(operationId);

            if (isCancelled()) return;

            setFiles(records);

        });

        if (err) {

            if (!isCancelled()) {

                setError(getErrorMessage(err));

            }

        }

        setIsLoading(false);

    }, [db, activeConfigName, loadingStatus, operationId]);

    // Get selected file
    const selectedFile = useMemo(() => {

        return files[selectedIndex];

    }, [files, selectedIndex]);

    // Keyboard handling
    useInput((_input, key) => {

        if (!isFocused) return;

        // Navigation
        if (key.upArrow) {

            setSelectedIndex((prev) => Math.max(0, prev - 1));

            return;

        }

        if (key.downArrow) {

            setSelectedIndex((prev) => Math.min(files.length - 1, prev + 1));

            return;

        }

        if (key.escape) {

            back();

            return;

        }

    });

    // No operation ID
    if (!operationId) {

        return (
            <Panel title="File Executions" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No operation selected.</Text>
            </Panel>
        );

    }

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="File Executions" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        );

    }

    // Loading
    if (isLoading || connLoading) {

        return (
            <Panel title={`File Executions (${operationName})`} paddingX={2} paddingY={1}>
                <Spinner label="Loading file executions..." />
            </Panel>
        );

    }

    // Error
    if (error || connError) {

        return (
            <Panel title="File Executions" paddingX={2} paddingY={1} borderColor="red">
                <Box flexDirection="column" gap={1}>
                    <Text color="red">Failed to load files: {error ?? connError}</Text>
                    <Text dimColor>Press Esc to go back</Text>
                </Box>
            </Panel>
        );

    }

    // Statistics
    const totalSuccess = files.filter((f) => f.status === 'success').length;
    const totalFailed = files.filter((f) => f.status === 'failed').length;
    const totalSkipped = files.filter((f) => f.status === 'skipped').length;

    return (
        <Panel title={`File Executions (${operationName})`} paddingX={2} paddingY={1}>
            <Box flexDirection="column" gap={1}>
                {/* Statistics */}
                <Box gap={2} flexWrap="wrap">
                    <Text>
                        Total: <Text bold>{files.length}</Text>
                    </Text>
                    <Text>
                        Success: <Text color="green">{totalSuccess}</Text>
                    </Text>
                    {totalFailed > 0 && (
                        <Text>
                            Failed: <Text color="red">{totalFailed}</Text>
                        </Text>
                    )}
                    {totalSkipped > 0 && (
                        <Text>
                            Skipped: <Text color="yellow">{totalSkipped}</Text>
                        </Text>
                    )}
                </Box>

                {/* File List */}
                {files.length === 0 ? (
                    <Box marginTop={1}>
                        <Text dimColor>No file executions recorded.</Text>
                    </Box>
                ) : (
                    <Box flexDirection="column" marginTop={1}>
                        {files.slice(0, 20).map((file, index) => {

                            const isSelected = index === selectedIndex;
                            const statusIndicator = getStatusIndicator(file.status);
                            const duration = file.durationMs
                                ? `(${(file.durationMs / 1000).toFixed(1)}s)`
                                : '';

                            return (
                                <Box key={file.id}>
                                    <Text color={isSelected ? 'cyan' : undefined}>
                                        {isSelected ? '>' : ' '}
                                    </Text>
                                    <Text color={statusIndicator.color}>
                                        {' '}
                                        {statusIndicator.icon}{' '}
                                    </Text>
                                    <Text
                                        color={isSelected ? 'cyan' : undefined}
                                        bold={isSelected}
                                    >
                                        {getFilename(file.filepath)}
                                    </Text>
                                    <Text dimColor> {duration}</Text>
                                    {file.status === 'skipped' && file.skipReason && (
                                        <Text dimColor> - {file.skipReason}</Text>
                                    )}
                                </Box>
                            );

                        })}
                        {files.length > 20 && (
                            <Text dimColor>
                                ...and {files.length - 20} more
                            </Text>
                        )}
                    </Box>
                )}

                {/* Selected file details */}
                {selectedFile && (
                    <Box
                        marginTop={1}
                        flexDirection="column"
                        borderStyle="single"
                        borderColor="gray"
                        paddingX={1}
                    >
                        <Text bold>File Details</Text>
                        <Text dimColor>Path: {selectedFile.filepath}</Text>
                        <Text dimColor>
                            Checksum: {selectedFile.checksum.slice(0, 16)}...
                        </Text>
                        {selectedFile.status === 'skipped' && selectedFile.skipReason && (
                            <Text color="yellow">Skip Reason: {selectedFile.skipReason}</Text>
                        )}
                        {selectedFile.status === 'failed' && selectedFile.errorMessage && (
                            <Box flexDirection="column">
                                <Text color="red">Error:</Text>
                                <Box marginLeft={2} flexDirection="column">
                                    {selectedFile.errorMessage.split('\n').map((line, i) => (
                                        <Text key={i} color="red" dimColor>
                                            {line}
                                        </Text>
                                    ))}
                                </Box>
                            </Box>
                        )}
                    </Box>
                )}

                {/* Keyboard hints */}
                <Box marginTop={1} gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        </Panel>
    );

}
