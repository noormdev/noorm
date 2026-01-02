/**
 * Result Table component.
 *
 * Interactive table renderer with client-side filtering and sorting.
 *
 * **Features:**
 * - Auto-calculated column widths
 * - Truncation for long values
 * - Scroll support for large result sets
 * - Filter by all columns or specific column
 * - Sort ascending/descending by any column
 *
 * @example
 * ```tsx
 * <ResultTable
 *     columns={['id', 'name', 'email']}
 *     rows={[{id: 1, name: 'Alice', email: 'alice@example.com'}]}
 * />
 * ```
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';

/**
 * Props for ResultTable component.
 */
export interface ResultTableProps {

    /** Column headers */
    columns: string[];

    /** Row data as array of objects */
    rows: Record<string, unknown>[];

    /** Maximum visible rows before scrolling */
    maxVisibleRows?: number;

    /** Maximum column width before truncation */
    maxColumnWidth?: number;

    /** Whether the table is active and should handle input */
    active?: boolean;

    /** Called when user presses Escape to return focus */
    onEscape?: () => void;

    /** Auto-sort by date column (desc) or ID (desc) on load. Default: true */
    autoSort?: boolean;

}

/**
 * Table interaction mode.
 */
type TableMode = 'browse' | 'filter' | 'sort';

/**
 * Sort direction.
 */
type SortDirection = 'asc' | 'desc';

/**
 * Filter state.
 */
interface FilterState {

    /** Filter search term */
    term: string;

    /** Column to filter on (null = all columns) */
    column: string | null;

}

/**
 * Sort state.
 */
interface SortState {

    /** Column to sort by */
    column: string;

    /** Sort direction */
    direction: SortDirection;

}

/**
 * Date column name patterns (priority order).
 */
const DATE_COLUMN_PATTERNS = [
    /^created[_-]?at$/i,
    /^updated[_-]?at$/i,
    /^modified[_-]?at$/i,
    /^timestamp$/i,
    /^datetime$/i,
    /^date$/i,
    /[_-]at$/i,
    /[_-]date$/i,
    /[_-]time$/i,
    /^created$/i,
    /^updated$/i,
    /^modified$/i,
];

/**
 * ID column name patterns.
 */
const ID_COLUMN_PATTERNS = [
    /^id$/i,
    /^_id$/i,
    /[_-]id$/i,
];

/**
 * Check if a value looks like a date.
 */
function looksLikeDate(value: unknown): boolean {

    if (value === null || value === undefined) return false;

    // Already a Date object
    if (value instanceof Date) return true;

    // Check string patterns
    if (typeof value === 'string') {

        // ISO date: 2024-01-15 or 2024-01-15T10:30:00
        if (/^\d{4}-\d{2}-\d{2}/.test(value)) return true;

        // Common date formats: 01/15/2024, 15-01-2024
        if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(value)) return true;

        // Try parsing - valid if result is reasonable date
        const parsed = Date.parse(value);
        if (!isNaN(parsed)) {

            const year = new Date(parsed).getFullYear();
            return year >= 1970 && year <= 2100;

        }

    }

    // Unix timestamp (number between 1970 and 2100 in seconds or ms)
    if (typeof value === 'number') {

        // Seconds (10 digits starting with 1)
        if (value > 1e9 && value < 2e9) return true;

        // Milliseconds (13 digits)
        if (value > 1e12 && value < 2e12) return true;

    }

    return false;

}

/**
 * Detect a date column from columns and sample rows.
 * Returns the column name or null if none found.
 */
function detectDateColumn(
    columns: string[],
    rows: Record<string, unknown>[],
): string | null {

    // Try each pattern in priority order
    for (const pattern of DATE_COLUMN_PATTERNS) {

        for (const col of columns) {

            if (pattern.test(col)) {

                // Verify at least one non-null value looks like a date
                const hasDateValue = rows.slice(0, 10).some((row) => {

                    const val = row[col];
                    return val !== null && val !== undefined;

                });

                if (hasDateValue) return col;

            }

        }

    }

    // Fallback: check values for date-like content
    for (const col of columns) {

        const sampleValues = rows.slice(0, 5).map((r) => r[col]);
        const dateCount = sampleValues.filter(looksLikeDate).length;

        // If majority of non-null samples look like dates
        if (dateCount >= 3) return col;

    }

    return null;

}

/**
 * Detect a numeric ID column from columns and sample rows.
 * Returns the column name or null if none found.
 */
function detectNumericIdColumn(
    columns: string[],
    rows: Record<string, unknown>[],
): string | null {

    for (const pattern of ID_COLUMN_PATTERNS) {

        for (const col of columns) {

            if (pattern.test(col)) {

                // Verify values are numeric
                const sampleValues = rows.slice(0, 5).map((r) => r[col]);
                const numericCount = sampleValues.filter((v) =>
                    typeof v === 'number' ||
                    (typeof v === 'string' && /^\d+$/.test(v)),
                ).length;

                if (numericCount >= 1) return col;

            }

        }

    }

    return null;

}

/**
 * Truncate a string to max length with ellipsis.
 */
function truncate(str: string, maxLen: number): string {

    if (str.length <= maxLen) return str;

    return str.slice(0, maxLen - 1) + '\u2026';

}

/**
 * Format a cell value for display.
 */
function formatCellValue(value: unknown): string {

    if (value === null) return 'NULL';
    if (value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);

    return String(value);

}

/**
 * Result Table component with filtering and sorting.
 */
export function ResultTable({
    columns,
    rows,
    maxVisibleRows = 15,
    maxColumnWidth = 30,
    active = true,
    onEscape,
    autoSort = true,
}: ResultTableProps): ReactElement {

    const isActive = active;

    // Compute initial sort based on data
    const initialSort = useMemo((): SortState | null => {

        if (!autoSort || columns.length === 0 || rows.length === 0) {

            return null;

        }

        // Priority 1: Date column (sort descending for most recent first)
        const dateCol = detectDateColumn(columns, rows);
        if (dateCol) {

            return { column: dateCol, direction: 'desc' };

        }

        // Priority 2: Numeric ID column (sort descending for newest first)
        const idCol = detectNumericIdColumn(columns, rows);
        if (idCol) {

            return { column: idCol, direction: 'desc' };

        }

        return null;

    }, [autoSort, columns, rows]);

    // State
    const [mode, setMode] = useState<TableMode>('browse');
    const [filter, setFilter] = useState<FilterState>({ term: '', column: null });
    const [sort, setSort] = useState<SortState | null>(initialSort);
    const [scrollOffset, setScrollOffset] = useState(0);
    const [highlightedRow, setHighlightedRow] = useState(0);
    const [sortColumnIndex, setSortColumnIndex] = useState(0);

    // Update sort when data changes (new query)
    useEffect(() => {

        setSort(initialSort);

    }, [initialSort]);

    // Calculate column widths
    const columnWidths = useMemo(() => {

        const widths: Record<string, number> = {};

        for (const col of columns) {

            // Start with header length
            let maxWidth = col.length;

            // Check all row values
            for (const row of rows) {

                const value = formatCellValue(row[col]);
                maxWidth = Math.max(maxWidth, value.length);

            }

            // Cap at max width
            widths[col] = Math.min(maxWidth, maxColumnWidth);

        }

        return widths;

    }, [columns, rows, maxColumnWidth]);

    // Apply filter
    const filteredRows = useMemo(() => {

        if (!filter.term) return rows;

        const searchTerm = filter.term.toLowerCase();

        return rows.filter((row) => {

            if (filter.column) {

                // Search specific column
                const value = formatCellValue(row[filter.column]).toLowerCase();

                return value.includes(searchTerm);

            }

            // Search all columns
            for (const col of columns) {

                const value = formatCellValue(row[col]).toLowerCase();

                if (value.includes(searchTerm)) return true;

            }

            return false;

        });

    }, [rows, filter, columns]);

    // Apply sort
    const sortedRows = useMemo(() => {

        if (!sort) return filteredRows;

        return [...filteredRows].sort((a, b) => {

            const aVal = a[sort.column];
            const bVal = b[sort.column];

            // Handle nulls
            if (aVal === null || aVal === undefined) return sort.direction === 'asc' ? 1 : -1;
            if (bVal === null || bVal === undefined) return sort.direction === 'asc' ? -1 : 1;

            // Compare values
            let comparison = 0;

            if (typeof aVal === 'number' && typeof bVal === 'number') {

                comparison = aVal - bVal;

            }
            else {

                comparison = String(aVal).localeCompare(String(bVal));

            }

            return sort.direction === 'asc' ? comparison : -comparison;

        });

    }, [filteredRows, sort]);

    // Visible rows (with scroll)
    const visibleRows = useMemo(() => {

        return sortedRows.slice(scrollOffset, scrollOffset + maxVisibleRows);

    }, [sortedRows, scrollOffset, maxVisibleRows]);

    // Reset scroll when filter changes
    useEffect(() => {

        setScrollOffset(0);
        setHighlightedRow(0);

    }, [filter.term, filter.column]);

    // Handle keyboard input
    useInput((input, key) => {

        if (!isActive) return;

        // Mode-specific handling
        if (mode === 'filter') {

            // Tab: Cycle column filter
            if (key.tab) {

                if (filter.column === null) {

                    const firstCol = columns[0];
                    setFilter((f) => ({ ...f, column: firstCol ?? null }));

                }
                else {

                    const currentIndex = columns.indexOf(filter.column);
                    const nextIndex = (currentIndex + 1) % (columns.length + 1);
                    const nextCol = nextIndex === columns.length ? null : (columns[nextIndex] ?? null);

                    setFilter((f) => ({
                        ...f,
                        column: nextCol,
                    }));

                }

                return;

            }

            // Escape: Clear filter and exit
            if (key.escape) {

                setFilter({ term: '', column: null });
                setMode('browse');

                return;

            }

            // Enter: Apply filter and exit
            if (key.return) {

                setMode('browse');

                return;

            }

            // Backspace
            if (key.backspace) {

                setFilter((f) => ({ ...f, term: f.term.slice(0, -1) }));

                return;

            }

            // Character input
            if (input && !key.ctrl && !key.meta) {

                setFilter((f) => ({ ...f, term: f.term + input }));

                return;

            }

            return;

        }

        if (mode === 'sort') {

            // Left/Right: Select column
            if (key.leftArrow) {

                setSortColumnIndex((i) => (i > 0 ? i - 1 : columns.length - 1));

                return;

            }

            if (key.rightArrow) {

                setSortColumnIndex((i) => (i < columns.length - 1 ? i + 1 : 0));

                return;

            }

            // a: Ascending
            if (input === 'a') {

                const col = columns[sortColumnIndex];
                if (col) {

                    setSort({ column: col, direction: 'asc' });
                    setMode('browse');

                }

                return;

            }

            // d: Descending
            if (input === 'd') {

                const col = columns[sortColumnIndex];
                if (col) {

                    setSort({ column: col, direction: 'desc' });
                    setMode('browse');

                }

                return;

            }

            // Escape/Enter: Exit
            if (key.escape || key.return) {

                setMode('browse');

                return;

            }

            return;

        }

        // Browse mode
        // Up/Down: Navigate rows
        if (key.upArrow) {

            if (highlightedRow > 0) {

                setHighlightedRow((r) => r - 1);

                // Scroll if needed
                if (highlightedRow - 1 < scrollOffset) {

                    setScrollOffset((o) => Math.max(0, o - 1));

                }

            }

            return;

        }

        if (key.downArrow) {

            if (highlightedRow < sortedRows.length - 1) {

                setHighlightedRow((r) => r + 1);

                // Scroll if needed
                if (highlightedRow + 1 >= scrollOffset + maxVisibleRows) {

                    setScrollOffset((o) => o + 1);

                }

            }

            return;

        }

        // /: Enter filter mode
        if (input === '/') {

            setMode('filter');

            return;

        }

        // s: Enter sort mode
        if (input === 's') {

            setMode('sort');
            setSortColumnIndex(sort ? columns.indexOf(sort.column) : 0);

            return;

        }

        // c: Clear filter and sort
        if (input === 'c') {

            setFilter({ term: '', column: null });
            setSort(null);

            return;

        }

        // Escape: Return focus
        if (key.escape) {

            onEscape?.();

            return;

        }

    });

    // Render a table row
    const renderRow = useCallback(
        (row: Record<string, unknown>, index: number, isHighlighted: boolean) => {

            return (
                <Box key={index}>
                    {columns.map((col, colIndex) => {

                        const colWidth = columnWidths[col] ?? col.length;
                        const value = truncate(formatCellValue(row[col]), colWidth);
                        const paddedValue = value.padEnd(colWidth);

                        return (
                            <Box key={col}>
                                {colIndex > 0 && <Text dimColor> | </Text>}
                                <Text
                                    inverse={isHighlighted}
                                    color={isHighlighted ? undefined : undefined}
                                >
                                    {paddedValue}
                                </Text>
                            </Box>
                        );

                    })}
                </Box>
            );

        },
        [columns, columnWidths],
    );

    // Calculate total width for separator
    const totalWidth = useMemo(() => {

        let width = 0;

        for (const col of columns) {

            width += columnWidths[col] ?? col.length;

        }

        // Add separators
        width += (columns.length - 1) * 3; // ' | '

        return width;

    }, [columns, columnWidths]);

    const hasFilter = filter.term.length > 0;
    const hasSort = sort !== null;
    const isFiltered = hasFilter && filteredRows.length !== rows.length;

    return (
        <Box flexDirection="column">
            {/* Status bar */}
            <Box marginBottom={1} gap={2}>
                {hasFilter && (
                    <Text>
                        <Text dimColor>Filter: </Text>
                        <Text color="yellow">"{filter.term}"</Text>
                        <Text dimColor> in </Text>
                        <Text color="cyan">[{filter.column ?? 'All'}]</Text>
                    </Text>
                )}
                {hasSort && (
                    <Text>
                        <Text dimColor>Sort: </Text>
                        <Text color="cyan">{sort!.column}</Text>
                        <Text> {sort!.direction === 'asc' ? '\u2191' : '\u2193'}</Text>
                    </Text>
                )}
                {mode === 'filter' && (
                    <Text color="yellow">
                        [Tab] Column  [Enter] Apply  [Esc] Cancel
                    </Text>
                )}
                {mode === 'sort' && (
                    <Text color="yellow">
                        [←/→] Column: {columns[sortColumnIndex]}  [a] Asc  [d] Desc
                    </Text>
                )}
            </Box>

            {/* Empty state */}
            {sortedRows.length === 0 ? (
                <Box>
                    <Text dimColor>
                        {hasFilter ? 'No matching rows' : 'No results'}
                    </Text>
                </Box>
            ) : (
                <>
                    {/* Header */}
                    <Box>
                        {columns.map((col, index) => {

                            const colWidth = columnWidths[col] ?? col.length;
                            const paddedCol = col.padEnd(colWidth);
                            const isSortColumn = sort?.column === col;

                            return (
                                <Box key={col}>
                                    {index > 0 && <Text dimColor> | </Text>}
                                    <Text bold color={isSortColumn ? 'cyan' : undefined}>
                                        {paddedCol}
                                        {isSortColumn && sort && (sort.direction === 'asc' ? '\u2191' : '\u2193')}
                                    </Text>
                                </Box>
                            );

                        })}
                    </Box>

                    {/* Separator */}
                    <Box>
                        <Text dimColor>{'\u2500'.repeat(totalWidth)}</Text>
                    </Box>

                    {/* Scroll indicator (up) */}
                    {scrollOffset > 0 && (
                        <Box>
                            <Text dimColor>↑ {scrollOffset} more above</Text>
                        </Box>
                    )}

                    {/* Rows */}
                    {visibleRows.map((row, index) => {

                        const actualIndex = scrollOffset + index;
                        const isHighlighted = actualIndex === highlightedRow;

                        return renderRow(row, actualIndex, isHighlighted);

                    })}

                    {/* Scroll indicator (down) */}
                    {scrollOffset + maxVisibleRows < sortedRows.length && (
                        <Box>
                            <Text dimColor>
                                ↓ {sortedRows.length - scrollOffset - maxVisibleRows} more below
                            </Text>
                        </Box>
                    )}
                </>
            )}

            {/* Footer */}
            <Box marginTop={1}>
                <Text dimColor>
                    {sortedRows.length} row{sortedRows.length !== 1 ? 's' : ''}
                    {isFiltered && ` (filtered from ${rows.length})`}
                </Text>
            </Box>

            {/* Help */}
            {mode === 'browse' && (
                <Box>
                    <Text dimColor>
                        [/] Filter  [s] Sort  [c] Clear  [↑/↓] Navigate
                    </Text>
                </Box>
            )}
        </Box>
    );

}
