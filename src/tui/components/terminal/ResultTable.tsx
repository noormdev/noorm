/**
 * Result Table component.
 *
 * Interactive table renderer with client-side filtering and sorting.
 *
 * **Features:**
 * - Auto-calculated column widths, chopped to what the row can hold
 * - Truncation for long values
 * - Scroll support for large result sets
 * - Filter by all columns or specific column
 * - Sort ascending/descending by any column
 *
 * **A wide result is chopped, not crammed.** Ink's `width` is a flex basis and
 * flex items shrink by default, so a row wider than the terminal does not
 * overflow — every cell loses columns at once, headers wrap onto a second line
 * and double each row's height, and values break mid-value. `fitGridColumns`
 * therefore keeps the leading columns that fit at a readable width and reports
 * the rest as a `… N more columns` marker. The filter and the sort picker still
 * see every column, because a column being off the right edge is a drawing
 * decision and not a reason it should stop being searchable.
 *
 * Cells are formatted through `documentValue`, the same normalizer the row
 * document viewer uses, so a `bytea` reads `<binary 40 bytes 0x…>` rather than
 * `{"type":"Buffer","data":[0,…` and a `Date` reads as a bare timestamp rather
 * than a quoted one.
 *
 * @example
 * ```tsx
 * <ResultTable
 *     columns={['id', 'name', 'email']}
 *     rows={[{id: 1, name: 'Alice', email: 'alice@example.com'}]}
 * />
 * ```
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import v from 'voca';
import type { ReactElement } from 'react';

import { isMouseReport, useRowMouse } from '../../mouse.js';
import { fitGridColumns } from './columnFit.js';
import { documentValue } from './rowDocument.js';

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

    /**
     * Cursor position, zero-based, into the rows as displayed.
     *
     * Supplying it makes the cursor controlled: the table draws this row and
     * reports where the arrows would move it instead of moving it itself. Left
     * out, the table keeps its own cursor, which is what the SQL terminal does.
     */
    highlightedRow?: number;

    /** Where the arrows moved the cursor, so a controlled parent can follow. */
    onHighlightChange?: (index: number) => void;

    /**
     * Enter on the cursor's row, in browse mode only, so the filter box keeps
     * its own Enter and the sort picker keeps its own.
     *
     * `rows` is the list as displayed — filtered and sorted — because a caller
     * that opens the picked row usually wants to step to the next one, and the
     * next one is the next in what the reader is looking at rather than the
     * next in what was handed in.
     */
    onSelect?: (row: Record<string, unknown>, index: number, rows: Record<string, unknown>[]) => void;

    /**
     * Tab in browse mode only, so the filter box keeps its column cycling.
     *
     * Named for the key rather than for an intent: this table has no idea what
     * is next to it, and the caller decides what leaving means.
     */
    onTab?: () => void;

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
 * Format a cell value for display.
 *
 * Routed through `documentValue` rather than `JSON.stringify` because the
 * drivers hand back real JavaScript and disagree per dialect about what: a
 * binary column arrives as a `Buffer` on three of them and a `Uint8Array` on
 * `bun:sqlite`, and either one stringifies to `{"type":"Buffer","data":[0,…`,
 * which is the wrapper rather than the value and which the width allocator will
 * happily spend a whole column on. `documentValue` was measured against all four
 * drivers; it also survives the two values that make `JSON.stringify` throw
 * outright, a `bigint` and MySQL's zero date.
 *
 * `undefined` stays blank and `null` stays `NULL`, which is the one place this
 * departs from the document: a grid has a column heading to say what the blank
 * is under, and a document has only the value.
 *
 * @example
 * formatCellValue(Buffer.of(0, 255)); // '<binary 2 bytes 0x00ff>'
 */
function formatCellValue(value: unknown): string {

    if (value === undefined) return '';

    const documented = documentValue(value);

    if (documented === null) return 'NULL';

    if (typeof documented === 'object') return JSON.stringify(documented);

    return String(documented);

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
    highlightedRow: controlledRow,
    onHighlightChange,
    onSelect,
    onTab,
}: ResultTableProps): ReactElement {

    const isActive = active;

    const isControlled = controlledRow !== undefined;

    // useWindowSize rather than a prop: how many columns fit is the terminal's
    // business, and this hook is what re-runs the fit when it resizes.
    const { columns: terminalColumns } = useWindowSize();

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
    const [internalRow, setInternalRow] = useState(0);
    const [sortColumnIndex, setSortColumnIndex] = useState(0);

    const highlightedRow = isControlled ? controlledRow : internalRow;

    // One mover for both cursors, so a controlled parent and an uncontrolled
    // table cannot drift into two different ideas of where the cursor is.
    const moveCursor = (next: number) => {

        if (!isControlled) setInternalRow(next);

        onHighlightChange?.(next);

    };

    // Held in a ref for the reset effect below. A parent that passes an inline
    // arrow - which is every parent - hands over a new function on every
    // render, so an effect that listed the mover in its dependencies would
    // re-run on every render and snap the cursor back to the top row on each
    // one, which looks exactly like the arrows not working.
    const moveCursorRef = useRef(moveCursor);
    moveCursorRef.current = moveCursor;

    // Update sort when data changes (new query)
    useEffect(() => {

        setSort(initialSort);

    }, [initialSort]);

    // Which columns are drawn and how wide each one is.
    //
    // The width a column wants comes from its own content, so a table of short
    // values keeps its density; the fit then decides how many of those columns
    // the row can actually hold and drops the rest off the right edge.
    const fit = useMemo(() => {

        const desired: Record<string, number> = {};

        for (const col of columns) {

            let want = col.length;

            for (const row of rows) {

                want = Math.max(want, formatCellValue(row[col]).length);

            }

            desired[col] = Math.min(want, maxColumnWidth);

        }

        return fitGridColumns(columns, desired, terminalColumns);

    }, [columns, rows, maxColumnWidth, terminalColumns]);

    const drawnColumns = fit.columns;
    const columnWidths = fit.widths;

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
            const comparison = (typeof aVal === 'number' && typeof bVal === 'number')
                ? aVal - bVal
                : String(aVal).localeCompare(String(bVal));

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
        moveCursorRef.current(0);

    }, [filter.term, filter.column]);

    // Keep the cursor in view when something outside moved it.
    //
    // The arrow handlers below scroll as they move, so for an uncontrolled
    // table this never fires. A controlled parent can set the cursor to
    // anywhere — the row view's ←/→ do exactly that — and the window has to
    // follow it or the reader escapes back to a table scrolled somewhere else.
    useEffect(() => {

        if (highlightedRow < scrollOffset) {

            setScrollOffset(highlightedRow);

            return;

        }

        if (highlightedRow >= scrollOffset + maxVisibleRows) {

            setScrollOffset(highlightedRow - maxVisibleRows + 1);

        }

    }, [highlightedRow, scrollOffset, maxVisibleRows]);

    // Handle keyboard input
    useInput((input, key) => {

        if (!isActive) return;

        // A mouse report reaches every useInput handler as a plain string, and
        // the filter box below would happily type `[<0;12;5M` into itself.
        // Dropped for the whole handler so a click can only ever do what the
        // mouse handler decides.
        if (isMouseReport(input)) return;

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

                moveCursor(highlightedRow - 1);

                // Scroll if needed
                if (highlightedRow - 1 < scrollOffset) {

                    setScrollOffset((o) => Math.max(0, o - 1));

                }

            }

            return;

        }

        if (key.downArrow) {

            if (highlightedRow < sortedRows.length - 1) {

                moveCursor(highlightedRow + 1);

                // Scroll if needed
                if (highlightedRow + 1 >= scrollOffset + maxVisibleRows) {

                    setScrollOffset((o) => o + 1);

                }

            }

            return;

        }

        // Enter: hand the cursor's row up. Only reached in browse mode, which
        // is what leaves the filter box's Enter and the sort picker's Enter
        // alone - both return above without falling through to here.
        if (key.return && onSelect) {

            const picked = sortedRows[highlightedRow];

            if (picked) onSelect(picked, highlightedRow, sortedRows);

            return;

        }

        // Tab: likewise. Guarded on the callback so a table without one behaves
        // exactly as it did before, rather than swallowing the key.
        if (key.tab && onTab) {

            onTab();

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

    // Mouse. Gated on browse mode for the same reason Enter and Tab are: the
    // filter box and the sort picker own their own keys, and a click should not
    // reach past whichever one is open. Inert without a MouseProvider above it
    // or with the setting off.
    const { rowRef } = useRowMouse({
        isActive: isActive && mode === 'browse',
        onClick: moveCursor,
        onActivate: (index) => {

            const picked = sortedRows[index];

            if (picked && onSelect) onSelect(picked, index, sortedRows);

        },
        onWheel: (delta) => {

            if (sortedRows.length === 0) return;

            const next = Math.min(Math.max(highlightedRow + delta, 0), sortedRows.length - 1);

            if (next !== highlightedRow) moveCursor(next);

        },
    });

    // Render a table row
    const renderRow = useCallback(
        (row: Record<string, unknown>, index: number, isHighlighted: boolean) => {

            return (
                <Box key={index} ref={rowRef(index)}>
                    {drawnColumns.map((col, colIndex) => {

                        const colWidth = columnWidths[col] ?? col.length;
                        const value = v.truncate(formatCellValue(row[col]), colWidth, '\u2026');
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
        [drawnColumns, columnWidths, rowRef],
    );

    // Calculate total width for separator
    const totalWidth = useMemo(() => {

        let width = 0;

        for (const col of drawnColumns) {

            width += columnWidths[col] ?? col.length;

        }

        // Add separators
        width += (drawnColumns.length - 1) * 3; // ' | '

        return width;

    }, [drawnColumns, columnWidths]);

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
                        {drawnColumns.map((col, index) => {

                            const colWidth = columnWidths[col] ?? col.length;
                            const isSortColumn = sort?.column === col;

                            // A header wider than its column used to be written
                            // out in full: Ink wrapped it onto a second line,
                            // which silently doubled the height of every row on
                            // screen and left the grid looking shredded. Cells
                            // have always truncated; headers now do too, and the
                            // sort arrow is charged to the same width instead of
                            // being added past it, which used to shift every
                            // column after it by one.
                            const labelWidth = Math.max(1, isSortColumn ? colWidth - 1 : colWidth);
                            const paddedCol = v.truncate(col, labelWidth, '\u2026').padEnd(labelWidth);

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

                        // Gated on `isActive`: a cursor is a claim that the
                        // arrows and Enter land here, and on a screen holding
                        // two tables two cursors make that claim twice.
                        const isHighlighted = isActive && actualIndex === highlightedRow;

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

            {/* Footer. The columns the fit dropped are reported here rather
                than on a line of their own: a caller sizing itself has to know
                how tall a table is before it lays one out, and a notice that
                appears only sometimes makes that a guess. This line is already
                in every caller's arithmetic. */}
            <Box marginTop={1}>
                <Text dimColor wrap="truncate">
                    {sortedRows.length} row{sortedRows.length !== 1 ? 's' : ''}
                    {isFiltered && ` (filtered from ${rows.length})`}
                    {fit.hidden > 0 && ` · … ${fit.hidden} more column${fit.hidden === 1 ? '' : 's'}`}
                    {fit.hidden > 0 && onSelect && isActive && ' — [↵] on a row shows them all'}
                </Text>
            </Box>

            {/* Help. Gated on `isActive`: these keys belong to whichever table
                currently has input, and an inactive one advertising them sends
                the reader pressing keys that go nowhere. */}
            {mode === 'browse' && isActive && (
                <Box>
                    <Text dimColor>
                        [/] Filter  [s] Sort  [c] Clear  [↑/↓] Navigate
                        {onSelect ? '  [↵] Open row' : ''}
                    </Text>
                </Box>
            )}
        </Box>
    );

}
