/**
 * SearchableList component - SelectList with inline search filtering.
 *
 * Wraps SelectList with a search input that filters items by label/description.
 * Press '/' to enter search mode, Esc to exit or clear.
 *
 * @example
 * ```tsx
 * <SearchableList
 *     items={tables}
 *     onSelect={(item) => navigate('db/explore/tables/detail', { name: item.value.name })}
 *     searchPlaceholder="Filter tables..."
 * />
 * ```
 */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';

import type { ReactElement } from 'react';

import { useFocusScope } from '../../focus.js';
import { SelectList } from './SelectList.js';

import type { SelectListItem } from './SelectList.js';

/**
 * Filter state for SearchableList (used for persistence).
 */
export interface SearchableListFilterState {
    /** Current search term */
    searchTerm: string;

    /** Currently highlighted item key */
    highlightedKey?: string;
}

/**
 * Props for SearchableList component.
 */
export interface SearchableListProps<T = unknown> {

    /** Items to display */
    items: SelectListItem<T>[];

    /** Callback when item is selected (Enter pressed) */
    onSelect?: (item: SelectListItem<T>) => void;

    /** Callback when highlighted item changes */
    onHighlight?: (item: SelectListItem<T>) => void;

    /** Placeholder text for search input */
    searchPlaceholder?: string;

    /** Label shown when no items */
    emptyLabel?: string;

    /** Label shown when no items match search */
    noResultsLabel?: string;

    /** Number of visible items before scrolling */
    visibleCount?: number;

    /** Focus scope label for keyboard handling */
    focusLabel?: string;

    /** External focus control - if provided, skips useFocusScope */
    isFocused?: boolean;

    /** Enable number key navigation (1-9 to select items directly) */
    numberNav?: boolean;

    /** Initial search term (for restoring state) */
    initialSearchTerm?: string;

    /** Initial highlighted item key (for restoring state) */
    initialHighlightedKey?: string;

    /** Callback when filter state changes (searchTerm or highlight) */
    onFilterChange?: (state: SearchableListFilterState) => void;

    /** Callback when Escape is pressed (and not in search mode with search text) */
    onCancel?: () => void;

}

/**
 * SearchableList component.
 *
 * A navigable list with inline search filtering.
 * Toggle search mode with '/', filter by typing, exit with Esc.
 */
export function SearchableList<T = unknown>({
    items,
    onSelect,
    onHighlight,
    searchPlaceholder = 'Search...',
    emptyLabel = 'No items',
    noResultsLabel = 'No matches',
    visibleCount = 8,
    focusLabel,
    isFocused: externalFocused,
    numberNav = false,
    initialSearchTerm = '',
    initialHighlightedKey,
    onFilterChange,
    onCancel,
}: SearchableListProps<T>): ReactElement {

    // Focus management
    const hasExternalFocus = externalFocused !== undefined;
    const internalFocus = useFocusScope({
        label: focusLabel ?? 'SearchableList',
        skip: hasExternalFocus,
    });
    const isFocused = hasExternalFocus ? externalFocused : internalFocus.isFocused;

    // Search state - initialize from props
    const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
    const [searchMode, setSearchMode] = useState(false);
    const [inputKey, setInputKey] = useState(0); // Key for forcing TextInput re-render

    // Track current highlighted key for persistence
    const [currentHighlightedKey, setCurrentHighlightedKey] = useState<string | undefined>(
        initialHighlightedKey,
    );

    // Track previous search mode for transition
    const prevSearchModeRef = useRef(searchMode);

    // Ref for onFilterChange to avoid stale closures
    const onFilterChangeRef = useRef(onFilterChange);
    onFilterChangeRef.current = onFilterChange;

    // Filter items based on search term
    const filteredItems = useMemo(() => {

        if (!searchTerm.trim()) return items;

        const lower = searchTerm.toLowerCase().trim();

        return items.filter((item) =>
            item.label.toLowerCase().includes(lower) ||
            (item.description?.toLowerCase().includes(lower) ?? false),
        );

    }, [items, searchTerm]);

    // Refs for useInput
    const searchModeRef = useRef(searchMode);
    const searchTermRef = useRef(searchTerm);
    searchModeRef.current = searchMode;
    searchTermRef.current = searchTerm;

    // Handle search input changes
    const handleSearchChange = useCallback((value: string) => {

        setSearchTerm(value);

        // Notify parent of filter change
        if (onFilterChangeRef.current) {

            onFilterChangeRef.current({
                searchTerm: value,
                highlightedKey: currentHighlightedKey,
            });

        }

    }, [currentHighlightedKey]);

    // Handle search input submission (Enter in search mode just exits search)
    const handleSearchSubmit = useCallback(() => {

        setSearchMode(false);

    }, []);

    // Clear search and force input re-render
    const clearSearch = useCallback(() => {

        setSearchTerm('');
        setInputKey((k) => k + 1); // Force new TextInput instance

        // Notify parent of filter change
        if (onFilterChangeRef.current) {

            onFilterChangeRef.current({
                searchTerm: '',
                highlightedKey: currentHighlightedKey,
            });

        }

    }, [currentHighlightedKey]);

    // Handle highlight changes from SelectList
    const handleHighlightChange = useCallback((item: SelectListItem<T>) => {

        setCurrentHighlightedKey(item.key);

        // Notify parent of filter change
        if (onFilterChangeRef.current) {

            onFilterChangeRef.current({
                searchTerm: searchTermRef.current,
                highlightedKey: item.key,
            });

        }

        // Also call user's onHighlight if provided
        if (onHighlight) {

            onHighlight(item);

        }

    }, [onHighlight]);

    // Handle keyboard for mode switching
    useInput((input, key) => {

        if (!isFocused) return;

        // '/' to enter search mode (only when not already in search mode)
        if (input === '/' && !searchModeRef.current) {

            setSearchMode(true);

            return;

        }

        // Escape handling
        if (key.escape) {

            if (searchModeRef.current) {

                // If there's search text, clear it first
                if (searchTermRef.current) {

                    clearSearch();

                }
                else {

                    // No search text, exit search mode
                    setSearchMode(false);

                }

                return;

            }

            // Not in search mode - call onCancel
            if (onCancel) {

                onCancel();

            }

            return;

        }

    });

    // Clear search when items change significantly (e.g., navigating to different category)
    useEffect(() => {

        prevSearchModeRef.current = searchMode;

    }, [searchMode]);

    // Calculate if we have results
    const hasItems = items.length > 0;
    const hasResults = filteredItems.length > 0;
    const isFiltering = searchTerm.trim().length > 0;

    return (
        <Box flexDirection="column" gap={1}>
            {/* Search input row */}
            <Box>
                <Text dimColor={!searchMode}>/</Text>
                <Box marginLeft={1} flexGrow={1}>
                    {searchMode ? (
                        <TextInput
                            key={inputKey}
                            placeholder={searchPlaceholder}
                            defaultValue={searchTerm}
                            onChange={handleSearchChange}
                            onSubmit={handleSearchSubmit}
                        />
                    ) : (
                        <Text dimColor>
                            {searchTerm || searchPlaceholder}
                        </Text>
                    )}
                </Box>
                {isFiltering && (
                    <Text dimColor> ({filteredItems.length} matches)</Text>
                )}
            </Box>

            {/* List or empty state */}
            {!hasItems ? (
                <Text dimColor>{emptyLabel}</Text>
            ) : !hasResults ? (
                <Text dimColor>{noResultsLabel}</Text>
            ) : (
                <SelectList
                    items={filteredItems}
                    onSelect={onSelect}
                    onHighlight={handleHighlightChange}
                    visibleCount={visibleCount}
                    isFocused={isFocused && !searchMode}
                    numberNav={numberNav}
                    defaultValue={currentHighlightedKey}
                />
            )}

            {/* Hint */}
            <Box>
                <Text dimColor>
                    {searchMode
                        ? '[Esc] ' + (searchTerm ? 'Clear' : 'Exit search')
                        : '[/] Search'
                    }
                </Text>
            </Box>
        </Box>
    );

}
