/**
 * FilePicker component - interactive file selector with search and multi-select.
 *
 * A three-mode file picker:
 * - Search mode: Type to filter files
 * - Select mode: Navigate and toggle file selection
 * - Accept mode: Confirm selection
 *
 * @example
 * ```tsx
 * <FilePicker
 *     files={sqlFiles}
 *     onSelect={(files) => runFiles(files)}
 *     onCancel={() => navigate('back')}
 * />
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';

import type { ReactElement } from 'react';

import { useFocusScope } from '../../focus.js';
import { Panel } from '../layout/Panel.js';

/**
 * File picker modes.
 */
export type FilePickerMode = 'search' | 'select' | 'accept';

/**
 * Props for FilePicker component.
 */
export interface FilePickerProps {
    /** Available files to select from */
    files: string[];

    /** Initially selected files */
    selected?: string[];

    /** Callback with selected files */
    onSelect: (files: string[]) => void;

    /** Callback when cancelled */
    onCancel: () => void;

    /** Maximum visible files in the list */
    visibleCount?: number;

    /** Focus scope label */
    focusLabel?: string;
}

/**
 * Filter files by search terms.
 *
 * Each space-separated term is applied as a sequential filter.
 */
function filterFiles(files: string[], search: string): string[] {

    if (!search.trim()) {

        return files;

    }

    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    let result = files;

    for (const term of terms) {

        result = result.filter((f) => f.toLowerCase().includes(term));

    }

    return result;

}

/**
 * FilePicker component.
 *
 * An interactive file selector with search filtering and multi-select.
 */
export function FilePicker({
    files,
    selected: initialSelected = [],
    onSelect,
    onCancel,
    visibleCount = 8,
    focusLabel = 'FilePicker',
}: FilePickerProps): ReactElement {

    const { isFocused } = useFocusScope(focusLabel);

    // State
    const [mode, setMode] = useState<FilePickerMode>('search');
    const [search, setSearch] = useState('');
    const [selectedSet, setSelectedSet] = useState<Set<string>>(() => new Set(initialSelected));
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);

    // Filtered files based on search
    const filteredFiles = useMemo(() => filterFiles(files, search), [files, search]);

    // Visible files window
    const visibleFiles = useMemo(
        () => filteredFiles.slice(scrollOffset, scrollOffset + visibleCount),
        [filteredFiles, scrollOffset, visibleCount],
    );

    // Mode label for header
    const modeLabel = mode === 'search' ? 'Search' : mode === 'select' ? 'Select' : 'Accept';

    // Toggle file selection
    const toggleFile = useCallback((filepath: string) => {

        setSelectedSet((prev) => {

            const next = new Set(prev);

            if (next.has(filepath)) {

                next.delete(filepath);

            }
            else {

                next.add(filepath);

            }

            return next;

        });

    }, []);

    // Cycle to next mode
    const cycleMode = useCallback(() => {

        setMode((prev) => {

            if (prev === 'search') return 'select';
            if (prev === 'select') return 'accept';

            return 'search';

        });

    }, []);

    // Navigate up in list
    const navigateUp = useCallback(() => {

        if (highlightIndex > 0) {

            setHighlightIndex((i) => i - 1);

            // Scroll up if needed
            if (highlightIndex <= scrollOffset) {

                setScrollOffset((o) => Math.max(0, o - 1));

            }

        }
        else if (filteredFiles.length > 0) {

            // Wrap to bottom
            const lastIndex = filteredFiles.length - 1;
            setHighlightIndex(lastIndex);
            setScrollOffset(Math.max(0, lastIndex - visibleCount + 1));

        }

    }, [highlightIndex, scrollOffset, filteredFiles.length, visibleCount]);

    // Navigate down in list
    const navigateDown = useCallback(() => {

        if (highlightIndex < filteredFiles.length - 1) {

            setHighlightIndex((i) => i + 1);

            // Scroll down if needed
            if (highlightIndex >= scrollOffset + visibleCount - 1) {

                setScrollOffset((o) => o + 1);

            }

        }
        else if (filteredFiles.length > 0) {

            // Wrap to top
            setHighlightIndex(0);
            setScrollOffset(0);

        }

    }, [highlightIndex, scrollOffset, filteredFiles.length, visibleCount]);

    // Handle submit
    const handleSubmit = useCallback(() => {

        if (mode === 'accept') {

            onSelect(Array.from(selectedSet));

        }
        else if (mode === 'select') {

            // Toggle current file
            const file = filteredFiles[highlightIndex];

            if (file) {

                toggleFile(file);

            }

        }
        else {

            // Search mode - switch to select
            cycleMode();

        }

    }, [mode, selectedSet, filteredFiles, highlightIndex, toggleFile, cycleMode, onSelect]);

    // Handle escape
    const handleEscape = useCallback(() => {

        if (mode === 'search' && search) {

            // Clear search
            setSearch('');
            setHighlightIndex(0);
            setScrollOffset(0);

        }
        else {

            onCancel();

        }

    }, [mode, search, onCancel]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        // Tab cycles mode
        if (key.tab) {

            cycleMode();

            return;

        }

        // Escape
        if (key.escape) {

            handleEscape();

            return;

        }

        // Enter
        if (key.return) {

            handleSubmit();

            return;

        }

        // Select mode navigation
        if (mode === 'select') {

            if (key.upArrow) {

                navigateUp();

                return;

            }

            if (key.downArrow) {

                navigateDown();

                return;

            }

            // Space toggles selection
            if (input === ' ') {

                const file = filteredFiles[highlightIndex];

                if (file) {

                    toggleFile(file);

                }

            }

        }

    });

    // Handle search input change
    const handleSearchChange = useCallback((value: string) => {

        setSearch(value);
        setHighlightIndex(0);
        setScrollOffset(0);

    }, []);

    return (
        <Panel
            title={`Select Files [${modeLabel} Mode]`}
            borderColor="cyan"
            paddingX={1}
            paddingY={1}
        >
            <Box flexDirection="column" gap={1}>
                {/* Search input */}
                <Box gap={1}>
                    <Text dimColor>Search:</Text>
                    {mode === 'search' ? (
                        <TextInput
                            placeholder="Type to filter..."
                            defaultValue={search}
                            onChange={handleSearchChange}
                            isDisabled={!isFocused}
                        />
                    ) : (
                        <Text>{search || '(all files)'}</Text>
                    )}
                </Box>

                {/* File list */}
                <Box flexDirection="column">
                    {scrollOffset > 0 && <Text dimColor> ↑ {scrollOffset} more above</Text>}

                    {visibleFiles.map((filepath, index) => {

                        const actualIndex = scrollOffset + index;
                        const isHighlighted = mode === 'select' && actualIndex === highlightIndex;
                        const isSelected = selectedSet.has(filepath);

                        return (
                            <Box key={filepath}>
                                <Text color={isHighlighted ? 'cyan' : undefined}>
                                    {isHighlighted ? '› ' : '  '}
                                    {isSelected ? '☑ ' : '☐ '}
                                    {filepath}
                                </Text>
                            </Box>
                        );

                    })}

                    {filteredFiles.length === 0 && <Text dimColor> No files match search</Text>}

                    {scrollOffset + visibleCount < filteredFiles.length && (
                        <Text dimColor>
                            {' '}
                            ↓ {filteredFiles.length - scrollOffset - visibleCount} more below
                        </Text>
                    )}
                </Box>

                {/* Status */}
                <Box>
                    <Text dimColor>
                        {filteredFiles.length} files shown ({selectedSet.size} selected)
                    </Text>
                </Box>

                {/* Help */}
                <Box gap={2}>
                    <Text dimColor>[Tab] switch mode</Text>
                    {mode === 'select' && <Text dimColor>[Space] toggle</Text>}
                    {mode === 'accept' && <Text dimColor>[Enter] accept</Text>}
                    <Text dimColor>[Esc] cancel</Text>
                </Box>
            </Box>
        </Panel>
    );

}
