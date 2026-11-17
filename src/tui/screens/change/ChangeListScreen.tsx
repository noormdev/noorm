/**
 * ChangeListScreen - view all changes with status.
 *
 * Shows changes from disk merged with database execution status.
 * Displays applied/pending/reverted/failed status for each.
 *
 * @example
 * ```bash
 * noorm change          # View changes
 * noorm change list     # Same thing
 * ```
 */
import { useRef, useState } from 'react';
import { Box, Text, useBoxMetrics, useInput, useWindowSize } from 'ink';

import type { DOMElement } from 'ink';
import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { SelectListItem, SelectListRowState } from '../../components/index.js';
import type { ChangeListItem } from '../../../core/change/types.js';
import { attempt } from '@logosdx/utils';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, SelectList } from '../../components/index.js';
import { useAsyncEffect } from '../../hooks/index.js';
import { MIN_VIEWPORT_ROWS, SCREEN_CHROME_ROWS, SCROLL_INDICATOR_ROWS } from '../../hooks/useViewportRows.js';
import { getErrorMessage, loadChangesWithStatus, buildMergedChangeList, oneLine } from '../../utils/index.js';
import { relativeTimeAgo } from '../../utils/date.js';
import { Hotkey, KeyTarget } from '../../components/layout/Hotkey.js';

/**
 * Rows this screen spends inside its Panel above the list: the statistics line
 * and the gap under it. The hint row's first line and the gap above it are in
 * `SCREEN_CHROME_ROWS`; any line the hints wrap onto is measured.
 */
const CHROME_ROWS = 2;

/**
 * Rows the detail box costs: the gap above it, two borders, three lines.
 *
 * Fixed at three lines whatever the change, as in `ChangeHistoryScreen`, so a
 * long database error cannot push the list off the screen.
 */
const DETAIL_ROWS = 6;

/**
 * Get status indicator for a change.
 */
function getStatusIndicator(item: ChangeListItem): { symbol: string; color: string } {

    if (item.orphaned) {

        return { symbol: '!', color: 'yellow' };

    }

    switch (item.status) {

    case 'success':
        return { symbol: '✓', color: 'green' };

    case 'failed':
        return { symbol: '✗', color: 'red' };

    case 'reverted':
        return { symbol: '↩', color: 'yellow' };

    case 'pending':
    default:
        return { symbol: '○', color: 'gray' };

    }

}

/**
 * Whether Enter and `r` run this change.
 */
function isRunnable(item: ChangeListItem): boolean {

    return item.status === 'pending' || item.status === 'failed' || item.status === 'reverted';

}

/**
 * What Enter does on this change, for the detail box's last line.
 */
function detailHint(item: ChangeListItem): string {

    if (isRunnable(item)) {

        return 'Press Enter to run';

    }

    if (item.status === 'success') {

        return 'Press Enter to revert';

    }

    return '';

}

/**
 * One change row. Must stay one line: `SelectList` windows by item, not by row.
 */
function changeRow(cs: ChangeListItem, state: SelectListRowState): ReactElement {

    const indicator = getStatusIndicator(cs);
    const isActive = state.isHighlighted && state.isFocused;

    return (
        <>
            <Text color={indicator.color}>{indicator.symbol} </Text>
            <Text
                color={isActive ? 'cyan' : cs.orphaned ? 'yellow' : undefined}
                bold={isActive}
                wrap="truncate"
            >
                {oneLine(cs.name)}
            </Text>
            <Text dimColor wrap="truncate">
                {cs.status === 'success' && cs.appliedAt && (
                    <> {relativeTimeAgo(cs.appliedAt)}</>
                )}
                {cs.status === 'pending' && '  pending'}
                {cs.status === 'reverted' && '  reverted'}
                {cs.status === 'failed' && '  failed'}
                {cs.orphaned && '  (orphaned)'}
            </Text>
        </>
    );

}

/**
 * ChangeListScreen component.
 */
export function ChangeListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ChangeList');
    const { activeConfig, activeConfigName, projectRoot, settings, loadingStatus } = useAppContext();

    const [changes, setChanges] = useState<ChangeListItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedChange, setSelectedChange] = useState<ChangeListItem | null>(null);

    // Above every early return so the hook count stays fixed across the async load.
    const { rows: terminalRows } = useWindowSize();
    const hintsRef = useRef<DOMElement>(null);
    const { height: hintRows } = useBoxMetrics(hintsRef);

    // Load changes
    useAsyncEffect(async (isCancelled) => {

        if (!activeConfig || loadingStatus !== 'ready') {

            setIsLoading(false);

            return;

        }

        setIsLoading(true);
        setError(null);

        const [_, err] = await attempt(async () => {

            const { changes: diskChanges, statuses, failures } = await loadChangesWithStatus(
                activeConfig, activeConfigName ?? '', settings, projectRoot,
            );

            if (isCancelled()) return;

            const merged = buildMergedChangeList(diskChanges, statuses, failures);

            // The list reports a highlight only while it has rows, so an empty
            // reload would otherwise leave the keys acting on a vanished change.
            if (merged.length === 0) setSelectedChange(null);

            setChanges(merged);

        });

        if (err) {

            if (!isCancelled()) {

                setError(getErrorMessage(err));

            }

        }

        setIsLoading(false);

    }, [activeConfig, activeConfigName, loadingStatus]);

    // Arrows and Enter belong to the SelectList below; this handles only what
    // the screen itself owns.
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        // Actions
        if (input === 'a') {

            navigate('change/add');

            return;

        }

        if (input === 'e' && selectedChange && !selectedChange.orphaned) {

            navigate('change/edit', { name: selectedChange.name });

            return;

        }

        if (input === 'd' && selectedChange) {

            navigate('change/rm', { name: selectedChange.name });

            return;

        }

        if (input === 'r' && selectedChange && isRunnable(selectedChange)) {

            navigate('change/run', { name: selectedChange.name });

            return;

        }

        if (input === 'v' && selectedChange && selectedChange.status === 'success') {

            navigate('change/revert', { name: selectedChange.name });

            return;

        }

        if (input === 'n') {

            navigate('change/next');

            return;

        }

        if (input === 'f') {

            navigate('change/ff');

            return;

        }

        if (input === 'w') {

            navigate('change/rewind');

            return;

        }

        if (input === 'h') {

            navigate('change/history');

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Changes" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration. Press 'c' to manage configs.</Text>
            </Panel>
        );

    }

    // Loading
    if (isLoading) {

        return (
            <Panel title="Changes" paddingX={2} paddingY={1}>
                <Spinner label="Loading changes..." />
            </Panel>
        );

    }

    // Error
    if (error) {

        return (
            <Panel title="Changes" paddingX={2} paddingY={1} borderColor="red">
                <Box flexDirection="column" gap={1}>
                    <Text color="red">Failed to load changes: {error}</Text>
                    <Text dimColor>Press Esc to go back</Text>
                </Box>
            </Panel>
        );

    }

    // Statistics
    const applied = changes.filter((cs) => cs.status === 'success').length;
    const pending = changes.filter((cs) => cs.status === 'pending').length;
    const failed = changes.filter((cs) => cs.status === 'failed').length;
    const orphaned = changes.filter((cs) => cs.orphaned).length;

    const items: SelectListItem<ChangeListItem>[] = changes.map((cs) => ({
        key: cs.name,
        label: cs.name,
        value: cs,
    }));

    // The detail box is the first thing a short terminal gives up: the list row
    // already carries the status, and a list cut below its floor overflows.
    const wrappedHintRows = Math.max(0, hintRows - 1);
    const rowsBesideDetail = terminalRows - SCREEN_CHROME_ROWS - CHROME_ROWS - wrappedHintRows - DETAIL_ROWS;
    const showDetail = rowsBesideDetail >= Math.min(changes.length, MIN_VIEWPORT_ROWS + SCROLL_INDICATOR_ROWS);
    const reserveRows = CHROME_ROWS + wrappedHintRows + (showDetail ? DETAIL_ROWS : 0);

    return (
        <Panel title="Changes" paddingX={2} paddingY={1}>
            <Box flexDirection="column" gap={1}>
                {/* Statistics */}
                <Box gap={2}>
                    <Text>
                        Total: <Text bold>{changes.length}</Text>
                    </Text>
                    <Text>
                        Applied: <Text color="green">{applied}</Text>
                    </Text>
                    <Text>
                        Pending: <Text color="yellow">{pending}</Text>
                    </Text>
                    {failed > 0 && (
                        <Text>
                            Failed: <Text color="red">{failed}</Text>
                        </Text>
                    )}
                    {orphaned > 0 && (
                        <Text>
                            Orphaned: <Text color="yellow">{orphaned}</Text>
                        </Text>
                    )}
                </Box>

                {/* Change List */}
                {changes.length === 0 ? (
                    <Box>
                        <KeyTarget keys="a"><Text dimColor>No changes found. Press [a] to create one.</Text></KeyTarget>
                    </Box>
                ) : (
                    <Box flexDirection="column">
                        <SelectList
                            items={items}
                            isFocused={isFocused}
                            reserveRows={reserveRows}
                            renderItem={(item, state) => changeRow(item.value, state)}
                            onHighlight={(item) => setSelectedChange(item.value)}
                            onSelect={(item) => {

                                if (isRunnable(item.value)) {

                                    navigate('change/run', { name: item.value.name });

                                }
                                else if (item.value.status === 'success') {

                                    navigate('change/revert', { name: item.value.name });

                                }

                            }}
                        />
                    </Box>
                )}

                {/* Selected change details, fixed at three lines - see DETAIL_ROWS */}
                {showDetail && selectedChange && (
                    <Box
                        flexDirection="column"
                        borderStyle="single"
                        borderColor={selectedChange.status === 'failed' ? 'red' : 'gray'}
                        paddingX={1}
                    >
                        <Text bold wrap="truncate">{oneLine(selectedChange.name)}</Text>
                        <Text dimColor wrap="truncate">
                            Change files: {selectedChange.changeFiles?.length ?? 0}
                            {'  '}Revert files: {selectedChange.revertFiles?.length ?? 0}
                            {selectedChange.appliedBy && `  Applied by: ${selectedChange.appliedBy}`}
                        </Text>
                        {selectedChange.status === 'failed' && selectedChange.errorMessage ? (
                            <Box>
                                <Box flexShrink={1}>
                                    <Text color="red" wrap="truncate">{oneLine(selectedChange.errorMessage)}</Text>
                                </Box>
                                <KeyTarget keys="h">
                                    <Text dimColor wrap="truncate">  full error: [h] History, select it, [e]</Text>
                                </KeyTarget>
                            </Box>
                        ) : (
                            <Text dimColor wrap="truncate">{detailHint(selectedChange)}</Text>
                        )}
                    </Box>
                )}

                {/* Keyboard hints, measured - see CHROME_ROWS */}
                <Box ref={hintsRef} flexWrap="wrap" columnGap={2}>
                    <Hotkey keys="a">Add</Hotkey>
                    <Hotkey keys="e">Edit</Hotkey>
                    <Hotkey keys="d">Delete</Hotkey>
                    <Hotkey keys="r">Run</Hotkey>
                    <Hotkey keys="v">Revert</Hotkey>
                    <Hotkey keys="n">Next</Hotkey>
                    <Hotkey keys="f">FF</Hotkey>
                    <Hotkey keys="w">Rewind</Hotkey>
                    <Hotkey keys="h">History</Hotkey>
                    <Hotkey keys="Esc">Back</Hotkey>
                </Box>
            </Box>
        </Panel>
    );

}
