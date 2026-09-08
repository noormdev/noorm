/**
 * ChangeHistoryDetailScreen - view file executions for an operation.
 *
 * Shows all files executed as part of a build, run, or change
 * with their individual status, duration, and errors.
 *
 * A build runs however many files the project has, so this is the screen most
 * likely to hold more rows than the terminal. It drew `files.slice(0, 20)` with
 * the cursor ranging over all of them, and rendered a failed file's error as one
 * `<Text>` per line of the message — so a stack trace pushed the file list, the
 * detail box and the hints off the bottom together. The list is now a
 * `SelectList`, which windows around its own cursor, and the error is a bounded
 * line here with the full text an Enter away in a `TextOverlay`.
 *
 * @example
 * ```bash
 * # Navigate from ChangeHistoryScreen by pressing Enter
 * ```
 */
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { SelectListItem, SelectListRowState } from '../../components/index.js';
import type { FileHistoryRecord } from '../../../core/change/types.js';

import { attempt } from '@logosdx/utils';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, SelectList, TextOverlay } from '../../components/index.js';
import { useConnection, useAsyncEffect } from '../../hooks/index.js';
import { ChangeHistory } from '../../../core/change/history.js';
import { getErrorMessage, oneLine } from '../../utils/index.js';

/**
 * Rows this screen spends inside its Panel on everything that is not the list.
 *
 * The statistics line and the gap under it, the list's own top margin, the gap
 * above the detail box, the box itself — two borders around three content lines
 * plus its top margin — and the gap before the hotkey hints, which are
 * themselves already counted by `SCREEN_CHROME_ROWS`.
 *
 * Three content lines whatever the record: the box used to grow a row per line
 * of a failed file's error message, which is exactly how an unlucky stack trace
 * took the whole screen with it.
 */
const CHROME_ROWS = 11;

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
 * One file row: status, filename, duration, skip reason.
 *
 * Drawn by the caller rather than handed over as a label because a reader scans
 * this list for the red row among the green, and a `label` string carries one
 * colour for the whole line.
 */
function fileRow(file: FileHistoryRecord, state: SelectListRowState): ReactElement {

    const statusIndicator = getStatusIndicator(file.status);
    const duration = file.durationMs ? `(${(file.durationMs / 1000).toFixed(1)}s)` : '';

    return (
        <>
            <Text color={statusIndicator.color}>{statusIndicator.icon} </Text>
            <Text
                color={state.isHighlighted && state.isFocused ? 'cyan' : undefined}
                bold={state.isHighlighted && state.isFocused}
                wrap="truncate"
            >
                {getFilename(file.filepath)}
            </Text>
            <Text dimColor wrap="truncate">
                {' '}{duration}
                {file.status === 'skipped' && file.skipReason ? ` - ${oneLine(file.skipReason)}` : ''}
            </Text>
        </>
    );

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
    const [selectedFile, setSelectedFile] = useState<FileHistoryRecord | null>(null);
    const [showError, setShowError] = useState(false);

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

    const failureText = selectedFile?.errorMessage ?? '';

    // Arrows belong to the SelectList below. Enter opens the error because a
    // file execution has nowhere further to drill into, so the only thing left
    // to ask of a row is what went wrong with it.
    useInput((_input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        if (key.return && failureText) {

            setShowError(true);

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

    if (showError && failureText) {

        return (
            <TextOverlay
                title={`Error — ${selectedFile ? getFilename(selectedFile.filepath) : 'File'}`}
                text={failureText}
                onClose={() => setShowError(false)}
            />
        );

    }

    // Statistics
    const totalSuccess = files.filter((f) => f.status === 'success').length;
    const totalFailed = files.filter((f) => f.status === 'failed').length;
    const totalSkipped = files.filter((f) => f.status === 'skipped').length;

    const items: SelectListItem<FileHistoryRecord>[] = files.map((file) => ({
        key: String(file.id),
        label: getFilename(file.filepath),
        value: file,
    }));

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
                <Box flexDirection="column" marginTop={1}>
                    <SelectList
                        items={items}
                        isFocused={isFocused}
                        reserveRows={CHROME_ROWS}
                        // Dismissing the error overlay remounts this list; the
                        // starting key is what stops that landing the reader
                        // back at the first file.
                        defaultValue={selectedFile ? String(selectedFile.id) : undefined}
                        emptyLabel="No file executions recorded."
                        renderItem={(item, state) => fileRow(item.value, state)}
                        onHighlight={(item) => setSelectedFile(item.value)}
                    />
                </Box>

                {/* Selected file details, fixed at three lines - see CHROME_ROWS */}
                {selectedFile && (
                    <Box
                        marginTop={1}
                        flexDirection="column"
                        borderStyle="single"
                        borderColor="gray"
                        paddingX={1}
                    >
                        <Text dimColor wrap="truncate">Path: {selectedFile.filepath}</Text>
                        <Text dimColor wrap="truncate">
                            Checksum: {selectedFile.checksum.slice(0, 16)}...
                        </Text>
                        {failureText ? (
                            <Text color="red" wrap="truncate">{oneLine(failureText)}</Text>
                        ) : selectedFile.status === 'skipped' && selectedFile.skipReason ? (
                            <Text color="yellow" wrap="truncate">
                                Skip Reason: {oneLine(selectedFile.skipReason)}
                            </Text>
                        ) : (
                            <Text dimColor>No errors recorded for this file.</Text>
                        )}
                    </Box>
                )}

                {/* Keyboard hints */}
                <Box marginTop={1} gap={2}>
                    <Text dimColor>[↑↓] Navigate</Text>
                    {failureText && <Text dimColor>[Enter] Full Error</Text>}
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        </Panel>
    );

}
