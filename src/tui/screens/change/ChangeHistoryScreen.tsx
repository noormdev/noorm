/**
 * ChangeHistoryScreen - view execution history for all operation types.
 *
 * Shows unified history of changes, builds, and runs with drill-down
 * to file execution details.
 *
 * The list is a `SelectList` rather than a hand-rolled column of rows. The
 * hand-rolled one drew `history.slice(0, 15)` while the cursor ranged over the
 * whole result, so past the fifteenth record the selection moved somewhere the
 * reader could not see, and the detail box below described a row that was not
 * on screen. `SelectList` owns the cursor and the window together, which is the
 * only arrangement where those two cannot disagree.
 *
 * @example
 * ```bash
 * noorm change history     # View execution history
 * ```
 */
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { SelectListItem, SelectListRowState } from '../../components/index.js';
import type { UnifiedHistoryRecord } from '../../../core/change/types.js';

import { attempt } from '@logosdx/utils';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, SelectList, TextOverlay } from '../../components/index.js';
import { useConnection, useAsyncEffect } from '../../hooks/index.js';
import { ChangeHistory } from '../../../core/change/history.js';
import { relativeTimeAgo } from '../../utils/date.js';
import { getErrorMessage, oneLine } from '../../utils/index.js';

/**
 * Records fetched for the list.
 *
 * Raised from 50 once the list could actually reach past its fifteenth row.
 * The query is a `LIMIT` on an indexed history table returning small rows, so
 * the ceiling is about what a reader can navigate, not about cost.
 */
const HISTORY_LIMIT = 200;

/**
 * Rows this screen spends inside its Panel on everything that is not the list.
 *
 * The statistics line and the gap under it, the list's own top margin, the gap
 * above the detail box, the box itself — two borders around three content lines
 * plus its top margin — and the gap before the hotkey hints. The hints are
 * already counted by `SCREEN_CHROME_ROWS`.
 *
 * The detail box draws exactly three lines whatever the record, rather than
 * growing one when there is an error to show, so this number stays true: a box
 * that sometimes takes a fourth row pushes the last list row under the status
 * bar, which is the failure this screen was rebuilt to remove.
 */
const CHROME_ROWS = 11;

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
 * One history row: status, type, name, age, duration.
 *
 * Drawn by the caller rather than handed to `SelectList` as a label because the
 * status colour is what a reader scans the list for — a red `[ERR]` in a column
 * of green is the whole point of the screen, and a single `label` string can
 * only be one colour.
 */
function historyRow(record: UnifiedHistoryRecord, state: SelectListRowState): ReactElement {

    const typeIndicator = getTypeIndicator(record.changeType);
    const statusOk = record.status === 'success';
    const duration = record.durationMs ? `(${(record.durationMs / 1000).toFixed(1)}s)` : '';

    return (
        <>
            <Text color={statusOk ? 'green' : 'red'}>{statusOk ? '[OK]' : '[ERR]'} </Text>
            <Text color={typeIndicator.color}>{typeIndicator.label} </Text>
            <Text
                color={state.isHighlighted && state.isFocused ? 'cyan' : undefined}
                bold={state.isHighlighted && state.isFocused}
                wrap="truncate"
            >
                {oneLine(record.name)}
            </Text>
            <Text dimColor wrap="truncate"> {relativeTimeAgo(record.executedAt)} {duration}</Text>
        </>
    );

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
    const [selectedRecord, setSelectedRecord] = useState<UnifiedHistoryRecord | null>(null);
    const [showError, setShowError] = useState(false);

    // Shared connection
    const { db, dialect, loading: connLoading, error: connError } = useConnection();

    // Load history when connection is ready
    useAsyncEffect(async (isCancelled) => {

        if (!db || loadingStatus !== 'ready') {

            if (!connLoading && !connError) setIsLoading(false);

            return;

        }

        setIsLoading(true);
        setError(null);

        const [_, err] = await attempt(async () => {

            const changeHistory = new ChangeHistory(db, activeConfigName ?? '', dialect ?? 'postgres');
            const records = await changeHistory.getUnifiedHistory(undefined, HISTORY_LIMIT);

            if (isCancelled()) return;

            setHistory(records);

        });

        if (err) {

            if (!isCancelled()) {

                setError(getErrorMessage(err));

            }

        }

        setIsLoading(false);

    }, [db, activeConfigName, loadingStatus]);

    const failureText = selectedRecord?.errorMessage ?? '';

    // Arrows and Enter belong to the SelectList below; this handles only what
    // the screen itself owns. While the overlay is mounted its own focus scope
    // sits on top, so `isFocused` is false here and both go quiet together.
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        if (input === 'e' && !key.ctrl && !key.meta && failureText) {

            setShowError(true);

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
    if (isLoading || connLoading) {

        return (
            <Panel title="Execution History" paddingX={2} paddingY={1}>
                <Spinner label="Loading history..." />
            </Panel>
        );

    }

    // Error
    if (error || connError) {

        return (
            <Panel title="Execution History" paddingX={2} paddingY={1} borderColor="red">
                <Box flexDirection="column" gap={1}>
                    <Text color="red">Failed to load history: {error ?? connError}</Text>
                    <Text dimColor>Press Esc to go back</Text>
                </Box>
            </Panel>
        );

    }

    if (showError && failureText) {

        return (
            <TextOverlay
                title={`Error — ${oneLine(selectedRecord?.name ?? 'Operation')}`}
                text={failureText}
                onClose={() => setShowError(false)}
            />
        );

    }

    // Statistics
    const totalChanges = history.filter((r) => r.changeType === 'change').length;
    const totalBuilds = history.filter((r) => r.changeType === 'build').length;
    const totalRuns = history.filter((r) => r.changeType === 'run').length;
    const totalSuccess = history.filter((r) => r.status === 'success').length;
    const totalFailed = history.filter((r) => r.status === 'failed').length;

    const items: SelectListItem<UnifiedHistoryRecord>[] = history.map((record) => ({
        key: String(record.id),
        label: record.name,
        value: record,
    }));

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
                <Box flexDirection="column" marginTop={1}>
                    <SelectList
                        items={items}
                        isFocused={isFocused}
                        reserveRows={CHROME_ROWS}
                        // Dismissing the error overlay remounts this list, and
                        // without a starting key it would remount at the top —
                        // sending the reader back to row one for having looked
                        // at the error on row forty.
                        defaultValue={selectedRecord ? String(selectedRecord.id) : undefined}
                        emptyLabel="No execution history found."
                        renderItem={(item, state) => historyRow(item.value, state)}
                        onHighlight={(item) => setSelectedRecord(item.value)}
                        onSelect={(item) => navigate('change/history/detail', {
                            operationId: item.value.id,
                            name: item.value.name,
                        })}
                    />
                </Box>

                {/* Selected record details, fixed at three lines - see CHROME_ROWS */}
                {selectedRecord && (
                    <Box
                        marginTop={1}
                        flexDirection="column"
                        borderStyle="single"
                        borderColor="gray"
                        paddingX={1}
                    >
                        <Text bold wrap="truncate">{oneLine(selectedRecord.name)}</Text>
                        <Text dimColor wrap="truncate">
                            By: {selectedRecord.executedBy}   Duration: {(selectedRecord.durationMs / 1000).toFixed(2)}s
                        </Text>
                        {failureText ? (
                            <Text color="red" wrap="truncate">
                                {oneLine(failureText)}
                            </Text>
                        ) : (
                            <Text dimColor>Press Enter to view file details</Text>
                        )}
                    </Box>
                )}

                {/* Keyboard hints */}
                <Box marginTop={1} gap={2}>
                    <Text dimColor>[↑↓] Navigate</Text>
                    <Text dimColor>[Enter] View Files</Text>
                    {failureText && <Text dimColor>[e] Full Error</Text>}
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        </Panel>
    );

}
