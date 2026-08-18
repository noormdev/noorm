/**
 * SelectList component - navigable list with selection callback.
 *
 * Custom implementation that integrates with our focus stack system.
 * Does not use @inkjs/ui Select to ensure proper keyboard handling.
 *
 * @example
 * ```tsx
 * <SelectList
 *     items={configs}
 *     onSelect={(config) => navigate('config/edit', { name: config.name })}
 *     onHighlight={(config) => setPreview(config)}
 * />
 * ```
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';

import { useFocusScope } from '../../focus.js';
import { useRowMouse } from '../../mouse.js';
import { useOptionalRouter } from '../../router.js';
import { listMemoryKey, recallListPosition, rememberListPosition } from '../../list-memory.js';
import { useViewportRows } from '../../hooks/useViewportRows.js';

/**
 * Item in a SelectList.
 */
export interface SelectListItem<T = unknown> {
    /** Unique identifier */
    key: string;

    /** Display text */
    label: string;

    /** Payload passed on select */
    value: T;

    /** Secondary text shown below label */
    description?: string;

    /** Prevent selection of this item */
    disabled?: boolean;

    /** Prefix icon */
    icon?: string;
}

/**
 * Props for SelectList component.
 */
export interface SelectListProps<T = unknown> {
    /** Items to display */
    items: SelectListItem<T>[];

    /** Callback when item is selected (Enter pressed in single-select mode) */
    onSelect?: (item: SelectListItem<T>) => void;

    /** Callback when highlighted item changes */
    onHighlight?: (item: SelectListItem<T>) => void;

    /** Label shown when no items */
    emptyLabel?: string;

    /**
     * Items visible before scrolling. Defaults to what the terminal has room
     * for, assuming the list owns the screen. Pass a number only to pin a list
     * that must not grow.
     */
    visibleCount?: number;

    /**
     * Rows of the screen that belong to something other than this list — an
     * intro paragraph above it, a banner over the Panel. Only the parent knows
     * these, and only they stop a terminal-sized list from overrunning them.
     */
    reserveRows?: number;

    /** Focus scope label for keyboard handling. If not provided, uses parent's focus. */
    focusLabel?: string;

    /** External focus control - if provided, skips useFocusScope */
    isFocused?: boolean;

    /** Initial selected value */
    defaultValue?: string;

    /** Whether the select is disabled */
    isDisabled?: boolean;

    /** Show description on a separate line below label (dimmed, indented) */
    showDescriptionBelow?: boolean;

    /** Enable number key navigation (1-9 to select items directly) */
    numberNav?: boolean;

    /**
     * Multi-select mode. When true:
     * - Space toggles selection (calls onToggle)
     * - Enter submits all selections (calls onSubmit)
     * When false (default):
     * - Enter selects the highlighted item (calls onSelect)
     */
    multiSelect?: boolean;

    /** Callback when item is toggled (Space in multi-select mode) */
    onToggle?: (item: SelectListItem<T>) => void;

    /** Callback when selection is submitted (Enter in multi-select mode) */
    onSubmit?: () => void;

    /** Callback when Escape is pressed (for navigation) */
    onCancel?: () => void;
}

/**
 * SelectList component.
 *
 * A navigable list with arrow key navigation and Enter to select.
 * Uses our custom focus stack for keyboard input routing.
 */
export function SelectList<T = unknown>({
    items,
    onSelect,
    onHighlight,
    emptyLabel = 'No items',
    visibleCount: pinnedVisibleCount,
    reserveRows = 0,
    focusLabel,
    isFocused: externalFocused,
    defaultValue,
    isDisabled = false,
    showDescriptionBelow = false,
    numberNav = false,
    multiSelect = false,
    onToggle,
    onSubmit,
    onCancel,
}: SelectListProps<T>): ReactElement {

    // Unconditional so the hook count is stable whether or not the caller
    // pinned a count; the pin wins when it is there. `visibleCount` counts
    // items while the budget counts rows, and those differ once a description
    // is drawn on its own line - halving assumes every item carries one, which
    // under-fills a mixed list rather than running it off the bottom.
    const availableRows = useViewportRows(reserveRows);
    const rowsPerItem = showDescriptionBelow ? 2 : 1;
    const visibleCount = pinnedVisibleCount ?? Math.max(1, Math.floor(availableRows / rowsPerItem));

    // Use external focus if provided, otherwise manage own focus scope
    const hasExternalFocus = externalFocused !== undefined;
    const internalFocus = useFocusScope({
        label: focusLabel ?? 'SelectList',
        skip: hasExternalFocus,
    });
    const isFocused = hasExternalFocus ? externalFocused : internalFocus.isFocused;

    // Filter enabled items
    const enabledItems = useMemo(() => items.filter((item) => !item.disabled), [items]);

    // Refs for latest values - useInput handler reads these to avoid stale closures
    const enabledItemsRef = useRef(enabledItems);
    const onSelectRef = useRef(onSelect);
    const onToggleRef = useRef(onToggle);
    const onSubmitRef = useRef(onSubmit);
    const onCancelRef = useRef(onCancel);
    enabledItemsRef.current = enabledItems;
    onSelectRef.current = onSelect;
    onToggleRef.current = onToggle;
    onSubmitRef.current = onSubmit;
    onCancelRef.current = onCancel;

    // Find initial index from defaultValue
    const initialIndex = useMemo(() => {

        if (!defaultValue) return 0;

        const index = enabledItems.findIndex((item) => item.key === defaultValue);

        return index >= 0 ? index : 0;

    }, [defaultValue, enabledItems]);

    // Current highlighted index
    const [highlightedIndex, setHighlightedIndex] = useState(initialIndex);

    // Reset highlighted index when items change (e.g., after deletion)
    useEffect(() => {

        if (enabledItems.length === 0) {

            setHighlightedIndex(0);

            return;

        }

        // Clamp index to valid range
        if (highlightedIndex >= enabledItems.length) {

            setHighlightedIndex(enabledItems.length - 1);

        }

    }, [enabledItems.length, highlightedIndex]);

    // Where this list's cursor is remembered. Derived from the router rather
    // than from a prop, so every list screen gets the behaviour without opting
    // in and the next one cannot forget to. `focusLabel` separates the lists on
    // the two routes that render more than one (`db/transfer`, `db/dt-modify`),
    // both of which already label theirs. Rendered without a router - a bare
    // list in a test - there is no key and nothing is remembered.
    const router = useOptionalRouter();
    const memoryKey = router ? listMemoryKey(router.route, router.params, focusLabel) : null;
    const arrivedBy = router?.arrivedBy;

    // Restore once, and only once there is something to match against: a screen
    // that fetches its rows mounts this list empty, and `useState` above has
    // already read its initial value by the time the rows land.
    const hasRestoredRef = useRef(false);

    useEffect(() => {

        if (hasRestoredRef.current || enabledItems.length === 0) return;

        hasRestoredRef.current = true;

        // Only on the way back. Restoring on every mount reads well for a
        // browsing list but it also rewinds the wizards, where each phase swaps
        // one list for another under a single route and a step is meant to open
        // on its own first row - `DbTransferScreen` opens its options on the
        // truncate toggle, and its test says so.
        if (arrivedBy !== 'pop') return;

        // An explicit defaultValue is the caller stating where to start, which
        // outranks where the user happened to leave the cursor last time.
        if (memoryKey === null || defaultValue !== undefined) return;

        const remembered = recallListPosition(memoryKey);

        if (remembered === undefined) return;

        const index = enabledItems.findIndex((item) => item.key === remembered);

        // A miss means the row was deleted while we were away. Leaving the
        // cursor at the top is the honest answer; an index would have restored
        // onto whichever row slid into the empty slot.
        if (index >= 0) setHighlightedIndex(index);

    }, [enabledItems, memoryKey, defaultValue, arrivedBy]);

    // Calculate visible window for scrolling
    const startIndex = useMemo(() => {

        if (enabledItems.length <= visibleCount) return 0;

        // Center the highlighted item in the visible window
        const halfVisible = Math.floor(visibleCount / 2);
        let start = highlightedIndex - halfVisible;

        // Clamp to valid range
        if (start < 0) start = 0;
        if (start > enabledItems.length - visibleCount) {

            start = enabledItems.length - visibleCount;

        }

        return start;

    }, [highlightedIndex, enabledItems.length, visibleCount]);

    const visibleItems = useMemo(
        () => enabledItems.slice(startIndex, startIndex + visibleCount),
        [enabledItems, startIndex, visibleCount],
    );

    // Notify on highlight change
    useEffect(() => {

        const item = enabledItems[highlightedIndex];

        if (!item) return;

        if (memoryKey !== null) {

            rememberListPosition(memoryKey, item.key);

        }

        if (onHighlight) {

            onHighlight(item);

        }

    }, [highlightedIndex, enabledItems, onHighlight, memoryKey]);

    // Handle keyboard navigation
    // Note: We don't use isActive option because it prevents handler registration
    // before focus is established. Instead we check isFocused inside the handler.
    useInput((input, key) => {

        if (!isFocused || isDisabled) return;

        // No guard against mouse reports here, deliberately. Every branch below
        // tests a named key or an exact character, and a report matches none of
        // them — `numberNav` runs it through parseInt and gets NaN. A guard was
        // written and then removed once the mutation harness showed that taking
        // it out changed nothing. The handlers that do need one are the ones
        // with a catch-all character branch: `ResultTable`'s filter box and
        // `SqlInput`.

        // Escape - cancel/back
        if (key.escape) {

            const currentOnCancel = onCancelRef.current;

            if (currentOnCancel) {

                currentOnCancel();

            }

            return;

        }

        // Up arrow - move highlight up (use ref for latest length)
        if (key.upArrow) {

            setHighlightedIndex((i) => (i > 0 ? i - 1 : enabledItemsRef.current.length - 1));

            return;

        }

        // Down arrow - move highlight down (use ref for latest length)
        if (key.downArrow) {

            setHighlightedIndex((i) => (i < enabledItemsRef.current.length - 1 ? i + 1 : 0));

            return;

        }

        // Space - toggle item in multi-select mode
        if (input === ' ' && multiSelect) {

            const currentItems = enabledItemsRef.current;
            const currentOnToggle = onToggleRef.current;
            const item = currentItems[highlightedIndex];

            if (item && currentOnToggle) {

                currentOnToggle(item);

            }

            return;

        }

        // Enter - select highlighted item or submit in multi-select mode
        if (key.return) {

            if (multiSelect) {

                // In multi-select mode, Enter submits the selection
                const currentOnSubmit = onSubmitRef.current;

                if (currentOnSubmit) {

                    currentOnSubmit();

                }

            }
            else {

                // In single-select mode, Enter selects the highlighted item
                const currentItems = enabledItemsRef.current;
                const currentOnSelect = onSelectRef.current;
                const item = currentItems[highlightedIndex];

                if (item && currentOnSelect) {

                    currentOnSelect(item);

                }

            }

            return;

        }

        // Number keys (1-9) for quick selection
        if (numberNav) {

            const num = parseInt(input, 10);

            if (num >= 1 && num <= 9) {

                const currentItems = enabledItemsRef.current;
                const currentOnSelect = onSelectRef.current;
                const item = currentItems[num - 1];

                if (item && currentOnSelect) {

                    currentOnSelect(item);

                }

            }

        }

    });

    /**
     * What Enter would do to one row.
     *
     * In multi-select Enter submits the whole list, which is not something a
     * click on a single row asked for. Space is the row-scoped key there, so
     * that is the one a double click borrows.
     */
    const activateRow = (index: number) => {

        const item = enabledItemsRef.current[index];

        if (!item) return;

        if (multiSelect) onToggleRef.current?.(item);
        else onSelectRef.current?.(item);

    };

    // Inert without a MouseProvider above it or with the setting off: no refs
    // are attached to the rows and nothing subscribes.
    const { rowRef } = useRowMouse({
        isActive: isFocused && !isDisabled,
        onClick: setHighlightedIndex,
        onActivate: activateRow,
        onWheel: (delta) => {

            setHighlightedIndex((current) => {

                const last = enabledItemsRef.current.length - 1;

                if (last < 0) return current;

                // Clamped, not wrapped. The arrows wrap, but a wheel that
                // jumps from the last row back to the first reads as a glitch
                // rather than as navigation.
                return Math.min(Math.max(current + delta, 0), last);

            });

        },
    });

    // Empty state
    if (enabledItems.length === 0) {

        return (
            <Box>
                <Text dimColor>{emptyLabel}</Text>
            </Box>
        );

    }

    // Calculate if we need scroll indicators
    const hasMoreAbove = startIndex > 0;
    const hasMoreBelow = startIndex + visibleCount < enabledItems.length;

    return (
        <Box flexDirection="column">
            {/* Scroll indicator - above */}
            {hasMoreAbove && <Text dimColor> ↑ {startIndex} more</Text>}

            {/* Visible items */}
            {visibleItems.map((item, visibleIndex) => {

                const actualIndex = startIndex + visibleIndex;
                const isHighlighted = actualIndex === highlightedIndex;

                // Number indicator (1-9, dimmed for items beyond 9)
                const numberIndicator = numberNav
                    ? actualIndex < 9
                        ? `${actualIndex + 1} `
                        : '  '
                    : '';

                return (
                    <Box key={item.key} flexDirection="column" ref={rowRef(actualIndex)}>
                        <Box>
                            {numberNav && (
                                <Text dimColor>{numberIndicator}</Text>
                            )}
                            <Text
                                color={isHighlighted && isFocused ? 'cyan' : undefined}
                                bold={isHighlighted && isFocused}
                            >
                                {isHighlighted ? '❯ ' : '  '}
                                {item.icon ? `${item.icon} ` : ''}
                                {item.label}
                                {/* Inline description (default behavior) */}
                                {!showDescriptionBelow && item.description && (
                                    <Text dimColor> {item.description}</Text>
                                )}
                            </Text>
                        </Box>
                        {/* Description below (when showDescriptionBelow is true) */}
                        {showDescriptionBelow && item.description && (
                            <Text dimColor> {item.description}</Text>
                        )}
                    </Box>
                );

            })}

            {/* Scroll indicator - below */}
            {hasMoreBelow && (
                <Text dimColor> ↓ {enabledItems.length - startIndex - visibleCount} more</Text>
            )}
        </Box>
    );

}
