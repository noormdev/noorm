/**
 * Log Viewer Overlay
 *
 * A global overlay that displays log entries from the noorm log file.
 * Accessible via Shift+L from anywhere in the app.
 *
 * Features:
 * - Live tail with 2-second auto-refresh
 * - Search filtering by event, message, or level
 * - Detail view showing full JSON
 * - Pause/resume functionality
 *
 * @example
 * ```tsx
 * {showLogViewer && <LogViewerOverlay onClose={handleClose} />}
 * ```
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';

import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { readLogFile } from '../../../core/logger/reader.js';
import { Spinner } from '../feedback/index.js';

import type { LogEntry } from '../../../core/logger/types.js';

/**
 * Props for LogViewerOverlay.
 */
export interface LogViewerOverlayProps {

    /** Callback to close the overlay */
    onClose: () => void;

}

/** Refresh interval in milliseconds */
const REFRESH_INTERVAL = 2000;

/** Number of visible entries in the list */
const VISIBLE_ENTRIES = 12;

/** Default log file path */
const DEFAULT_LOG_PATH = '.noorm/noorm.log';

/**
 * Get color for log level.
 */
function getLevelColor(level: string): string {

    switch (level) {

    case 'error': return 'red';
    case 'warn': return 'yellow';
    case 'info': return 'green';
    case 'debug': return 'gray';
    default: return 'white';

    }

}

/**
 * Format time for display.
 */
function formatTime(time: string): string {

    try {

        const date = new Date(time);

        return date.toLocaleTimeString('en-US', { hour12: false });

    }
    catch {

        return time.slice(11, 19);

    }

}

/**
 * Log Viewer Overlay component.
 */
export function LogViewerOverlay({ onClose }: LogViewerOverlayProps): ReactElement {

    const { isFocused } = useFocusScope('LogViewerOverlay');
    const { settings } = useAppContext();

    // State
    const [entries, setEntries] = useState<LogEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [searchMode, setSearchMode] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [showDetail, setShowDetail] = useState(false);
    const [paused, setPaused] = useState(false);

    // Refs
    const searchTermRef = useRef(searchTerm);
    searchTermRef.current = searchTerm;

    // Get log path from settings
    const logPath = settings?.logging?.file ?? DEFAULT_LOG_PATH;

    // Load logs
    const loadLogs = useCallback(async () => {

        const result = await readLogFile(logPath, { limit: 500 });
        setEntries(result.entries);
        setIsLoading(false);

    }, [logPath]);

    // Initial load
    useEffect(() => {

        loadLogs();

    }, [loadLogs]);

    // Live tail - refresh every 2s unless paused
    useEffect(() => {

        if (paused) return;

        const interval = setInterval(loadLogs, REFRESH_INTERVAL);

        return () => clearInterval(interval);

    }, [loadLogs, paused]);

    // Filter entries
    const filteredEntries = useMemo(() => {

        if (!searchTerm) return entries;

        const term = searchTerm.toLowerCase();

        return entries.filter((e) =>
            e.type.toLowerCase().includes(term) ||
            e.message.toLowerCase().includes(term) ||
            e.level.toLowerCase().includes(term),
        );

    }, [entries, searchTerm]);

    // Reset highlighted index when filter changes
    useEffect(() => {

        setHighlightedIndex(0);

    }, [searchTerm]);

    // Keyboard navigation
    useInput((input, key) => {

        if (!isFocused) return;

        // Escape - close detail, exit search, or close overlay
        if (key.escape) {

            if (showDetail) {

                setShowDetail(false);

                return;

            }

            if (searchMode) {

                setSearchMode(false);
                setSearchTerm('');

                return;

            }

            onClose();

            return;

        }

        // In detail view, only Escape works
        if (showDetail) return;

        // Search mode input
        if (searchMode) {

            // Handle both backspace and delete (terminals vary)
            if (key.backspace || key.delete) {

                setSearchTerm((prev) => prev.slice(0, -1));

            }
            else if (key.return) {

                // Exit search mode on Enter
                setSearchMode(false);

            }
            else if (input && !key.ctrl && !key.meta && input.length === 1) {

                setSearchTerm((prev) => prev + input);

            }

            return;

        }

        // / - enter search mode
        if (input === '/') {

            setSearchMode(true);

            return;

        }

        // Space - toggle pause
        if (input === ' ') {

            setPaused((prev) => !prev);

            return;

        }

        // r - manual refresh
        if (input === 'r' || input === 'R') {

            loadLogs();

            return;

        }

        // g - jump to top (newest), G - jump to bottom (oldest)
        if (input === 'g') {

            setHighlightedIndex(0);

            return;

        }

        if (input === 'G') {

            setHighlightedIndex(Math.max(0, filteredEntries.length - 1));

            return;

        }

        // Arrow navigation
        if (key.upArrow) {

            setHighlightedIndex((prev) => Math.max(0, prev - 1));

        }
        else if (key.downArrow) {

            setHighlightedIndex((prev) =>
                Math.min(filteredEntries.length - 1, prev + 1),
            );

        }
        else if (key.pageUp) {

            setHighlightedIndex((prev) =>
                Math.max(0, prev - VISIBLE_ENTRIES),
            );

        }
        else if (key.pageDown) {

            setHighlightedIndex((prev) =>
                Math.min(filteredEntries.length - 1, prev + VISIBLE_ENTRIES),
            );

        }

        // Enter - show detail
        if (key.return && filteredEntries[highlightedIndex]) {

            setShowDetail(true);

        }

    });

    // Calculate visible window
    const startIdx = Math.max(0, highlightedIndex - Math.floor(VISIBLE_ENTRIES / 2));
    const visibleEntries = filteredEntries.slice(startIdx, startIdx + VISIBLE_ENTRIES);

    // Detail view
    if (showDetail && filteredEntries[highlightedIndex]) {

        const entry = filteredEntries[highlightedIndex];

        return (
            <Box flexDirection="column" minHeight={20}>
                {/* Header */}
                <Box
                    borderStyle="single"
                    borderBottom
                    borderTop={false}
                    borderLeft={false}
                    borderRight={false}
                    borderColor="blue"
                    paddingX={1}
                    gap={2}
                >
                    <Text bold color="blue">Log Entry Detail</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>

                {/* Content */}
                <Box flexDirection="column" paddingX={1} paddingY={1} flexGrow={1}>
                    <Text wrap="wrap">{JSON.stringify(entry, null, 2)}</Text>
                </Box>

                {/* Footer */}
                <Box
                    borderStyle="single"
                    borderTop
                    borderBottom={false}
                    borderLeft={false}
                    borderRight={false}
                    borderColor="gray"
                    paddingX={1}
                >
                    <Text dimColor>[Esc] Back to list</Text>
                </Box>
            </Box>
        );

    }

    return (
        <Box flexDirection="column" minHeight={20}>
            {/* Header */}
            <Box
                borderStyle="single"
                borderBottom
                borderTop={false}
                borderLeft={false}
                borderRight={false}
                borderColor="blue"
                paddingX={1}
                gap={2}
            >
                <Text bold color="blue">Logs</Text>
                {paused ? (
                    <Text color="yellow">PAUSED</Text>
                ) : (
                    <Text color="green">LIVE</Text>
                )}
                <Text dimColor>({filteredEntries.length} entries)</Text>
            </Box>

            {/* Search bar */}
            <Box paddingX={1} paddingTop={1}>
                <Text dimColor>/</Text>
                {searchMode ? (
                    <Text>
                        {searchTerm}
                        <Text inverse> </Text>
                    </Text>
                ) : (
                    <Text dimColor>{searchTerm || ' type / to search'}</Text>
                )}
            </Box>

            {/* Log entries */}
            <Box flexDirection="column" paddingX={1} paddingY={1} flexGrow={1}>
                {isLoading ? (
                    <Spinner label="Loading logs..." />
                ) : filteredEntries.length === 0 ? (
                    <Text dimColor>
                        {entries.length === 0
                            ? 'No log entries found'
                            : 'No entries match your search'}
                    </Text>
                ) : (
                    <Box flexDirection="column">
                        {visibleEntries.map((entry, idx) => {

                            const actualIdx = startIdx + idx;
                            const isHighlighted = actualIdx === highlightedIndex;

                            return (
                                <Box key={`${entry.time}-${actualIdx}`} gap={1}>
                                    <Text inverse={isHighlighted}>
                                        {isHighlighted ? '>' : ' '}
                                    </Text>
                                    <Box width={8}>
                                        <Text dimColor>{formatTime(entry.time)}</Text>
                                    </Box>
                                    <Box width={6}>
                                        <Text color={getLevelColor(entry.level)}>
                                            {entry.level.toUpperCase().padEnd(5)}
                                        </Text>
                                    </Box>
                                    <Box width={25}>
                                        <Text color="cyan">{entry.type.slice(0, 24)}</Text>
                                    </Box>
                                    <Text>{entry.message.slice(0, 45)}</Text>
                                </Box>
                            );

                        })}
                    </Box>
                )}
            </Box>

            {/* Footer */}
            <Box
                borderStyle="single"
                borderTop
                borderBottom={false}
                borderLeft={false}
                borderRight={false}
                borderColor="gray"
                paddingX={1}
                gap={2}
            >
                <Text dimColor>[/] Search</Text>
                <Text dimColor>[g/G] Top/Bottom</Text>
                <Text dimColor>[Space] {paused ? 'Resume' : 'Pause'}</Text>
                <Text dimColor>[Enter] Detail</Text>
                <Text dimColor>[Shift+L] Close</Text>
            </Box>
        </Box>
    );

}
