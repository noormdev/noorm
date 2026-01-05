/**
 * DebugListScreen - browse rows in a noorm internal table.
 *
 * Shows all rows from a selected internal table with filtering, sorting,
 * and delete capabilities.
 *
 * Keyboard shortcuts:
 * - /: Enter search mode
 * - s: Cycle sort column
 * - S: Toggle sort direction
 * - d: Delete selected row
 * - D: Delete all filtered rows
 * - Enter: View row detail
 * - 1-9: Quick select row
 * - Esc: Go back
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormTableName, NoormTableRow, SortDirection } from '../../../core/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import type { Kysely } from 'kysely';

import { Panel, Spinner, Confirm, SearchableList, useToast } from '../../components/index.js';
import { createConnection, testConnection } from '../../../core/connection/index.js';
import { type NoormDatabase } from '../../../core/index.js';
import {
    createDebugOperations,
    getTableInfo,
    type DebugOperations,
} from '../../../core/debug/index.js';

import type { SelectListItem } from '../../components/lists/SelectList.js';

/**
 * Delete confirmation state.
 */
interface DeleteConfirmState {
    mode: 'single' | 'bulk';
    ids: number[];
}

/**
 * DebugListScreen component.
 *
 * Displays rows from a noorm internal table with filtering, sorting, and delete.
 */
export function DebugListScreen({ params }: ScreenProps): ReactElement {

    const tableName = params.table as NoormTableName | undefined;
    const tableInfo = tableName ? getTableInfo(tableName) : undefined;

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('DebugList');
    const { activeConfig, activeConfigName } = useAppContext();
    const { showToast } = useToast();

    // Data state
    const [rows, setRows] = useState<NoormTableRow[]>([]);
    const [columns, setColumns] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Sort state
    const [sortColumn, setSortColumn] = useState<string>('id');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    // Delete confirmation state
    const [confirmDelete, setConfirmDelete] = useState<DeleteConfirmState | null>(null);

    // Operations ref for delete actions
    const [operations, setOperations] = useState<DebugOperations | null>(null);
    const [, setConnectionLabel] = useState<string>('');

    // Highlighted row for delete
    const [highlightedRowId, setHighlightedRowId] = useState<number | null>(null);

    // Load table data
    useEffect(() => {

        if (!activeConfig || !tableName) {

            setIsLoading(false);

            return;

        }

        let cancelled = false;

        const load = async () => {

            setIsLoading(true);
            setError(null);

            // Test connection first
            const testResult = await testConnection(activeConfig.connection);

            if (!testResult.ok) {

                if (!cancelled) {

                    setError(testResult.error ?? 'Connection failed');
                    setIsLoading(false);

                }

                return;

            }

            // Fetch rows
            const [result, err] = await attempt(async () => {

                const label = activeConfigName ?? '__debug__';
                const conn = await createConnection(activeConfig.connection, label);
                const ops = createDebugOperations(conn.db as Kysely<NoormDatabase>);

                const cols = ops.getTableColumns(tableName);
                const data = await ops.getTableRows(tableName, {
                    sortColumn,
                    sortDirection,
                    limit: 500,
                });

                // Store operations for delete actions (connection stays open)
                setOperations(ops);
                setConnectionLabel(label);

                return { cols, data };

            });

            if (cancelled) return;

            if (err) {

                setError(err.message);

            }
            else if (result) {

                setColumns(result.cols);
                setRows(result.data);

            }

            setIsLoading(false);

        };

        load();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, tableName, sortColumn, sortDirection]);

    // Sort rows locally (already sorted from DB, but this handles re-sort)
    const sortedRows = useMemo(() => {

        return [...rows].sort((a, b) => {

            const aVal = a[sortColumn];
            const bVal = b[sortColumn];

            // Handle nulls
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return sortDirection === 'asc' ? -1 : 1;
            if (bVal == null) return sortDirection === 'asc' ? 1 : -1;

            // Compare
            let cmp = 0;

            if (typeof aVal === 'number' && typeof bVal === 'number') {

                cmp = aVal - bVal;

            }
            else {

                cmp = String(aVal).localeCompare(String(bVal));

            }

            return sortDirection === 'asc' ? cmp : -cmp;

        });

    }, [rows, sortColumn, sortDirection]);

    // Convert rows to list items
    const listItems: SelectListItem<NoormTableRow>[] = useMemo(() => {

        return sortedRows.map((row) => {

            const id = row['id'] as number;

            // Build label from key columns
            const labelParts: string[] = [`#${id}`];

            // Add a few key columns depending on table
            if (row['name']) labelParts.push(String(row['name']));
            if (row['status']) labelParts.push(String(row['status']));
            if (row['config_name']) labelParts.push(`config=${row['config_name']}`);
            if (row['email']) labelParts.push(String(row['email']));
            if (row['cli_version']) labelParts.push(`v${row['cli_version']}`);

            // Build description from remaining columns
            const descParts: string[] = [];

            if (row['executed_at']) descParts.push(formatDate(row['executed_at']));
            if (row['duration_ms']) descParts.push(`${row['duration_ms']}ms`);
            if (row['filepath']) descParts.push(truncate(String(row['filepath']), 40));
            if (row['locked_by']) descParts.push(`by ${row['locked_by']}`);

            return {
                key: String(id),
                label: labelParts.join('  '),
                description: descParts.join(' | '),
                value: row,
            };

        });

    }, [sortedRows]);

    // Handle row selection
    const handleSelect = useCallback((item: SelectListItem<NoormTableRow>) => {

        const id = item.value['id'] as number;

        navigate('debug/table/detail', { table: tableName, rowId: id });

    }, [navigate, tableName]);

    // Handle highlight change
    const handleHighlight = useCallback((item: SelectListItem<NoormTableRow>) => {

        setHighlightedRowId(item.value['id'] as number);

    }, []);

    // Cycle sort column
    const cycleSortColumn = useCallback(() => {

        const currentIndex = columns.indexOf(sortColumn);
        const nextIndex = (currentIndex + 1) % columns.length;
        const nextColumn = columns[nextIndex];

        if (nextColumn) {

            setSortColumn(nextColumn);

        }

    }, [columns, sortColumn]);

    // Toggle sort direction
    const toggleSortDirection = useCallback(() => {

        setSortDirection((d) => d === 'asc' ? 'desc' : 'asc');

    }, []);

    // Handle delete single row
    const handleDeleteSingle = useCallback(() => {

        if (highlightedRowId == null) return;

        setConfirmDelete({ mode: 'single', ids: [highlightedRowId] });

    }, [highlightedRowId]);

    // Handle delete filtered rows
    const handleDeleteFiltered = useCallback(() => {

        const ids = sortedRows.map((r) => r['id'] as number);

        if (ids.length === 0) return;

        setConfirmDelete({ mode: 'bulk', ids });

    }, [sortedRows]);

    // Perform delete
    const performDelete = useCallback(async () => {

        if (!confirmDelete || !operations || !tableName) return;

        const { mode, ids } = confirmDelete;

        setConfirmDelete(null);

        if (mode === 'single') {

            const rowId = ids[0];

            if (rowId === undefined) return;

            const success = await operations.deleteRowById(tableName, rowId);

            if (success) {

                setRows((prev) => prev.filter((r) => r['id'] !== rowId));
                showToast({ message: `Deleted row #${rowId}`, variant: 'success' });

            }
            else {

                showToast({ message: 'Delete failed', variant: 'error' });

            }

        }
        else {

            const count = await operations.deleteRowsByIds(tableName, ids);

            if (count > 0) {

                const idSet = new Set(ids);

                setRows((prev) => prev.filter((r) => !idSet.has(r['id'] as number)));
                showToast({ message: `Deleted ${count} rows`, variant: 'success' });

            }
            else {

                showToast({ message: 'Delete failed', variant: 'error' });

            }

        }

    }, [confirmDelete, operations, tableName, showToast]);

    // Keyboard navigation (when not in confirm dialog)
    useInput((input, key) => {

        if (!isFocused || confirmDelete) return;

        if (key.escape) {

            back();

            return;

        }

        // Sort controls
        if (input === 's') {

            cycleSortColumn();

            return;

        }

        if (input === 'S') {

            toggleSortDirection();

            return;

        }

        // Delete controls
        if (input === 'd') {

            handleDeleteSingle();

            return;

        }

        if (input === 'D') {

            handleDeleteFiltered();

            return;

        }

    });

    // No table specified
    if (!tableName || !tableInfo) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="DEBUG MODE" borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="red">No table specified</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="DEBUG MODE" borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="yellow">No active configuration selected.</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading state
    if (isLoading) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={`DEBUG: ${tableInfo.displayName}`} borderColor="red" paddingX={1} paddingY={1}>
                    <Spinner label={`Loading ${tableName}...`} />
                </Panel>
            </Box>
        );

    }

    // Error state
    if (error) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={`DEBUG: ${tableInfo.displayName}`} borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Error</Text>
                        <Text dimColor>{error}</Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Delete confirmation dialog
    if (confirmDelete) {

        const message = confirmDelete.mode === 'single'
            ? `Delete row #${confirmDelete.ids[0]} from ${tableName}?`
            : `Delete ${confirmDelete.ids.length} rows from ${tableName}?`;

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={`DEBUG: ${tableInfo.displayName}`} borderColor="red" paddingX={1} paddingY={1}>
                    <Text dimColor>{rows.length} rows | Sorted by: {sortColumn} {sortDirection === 'asc' ? '\u2191' : '\u2193'}</Text>
                </Panel>

                <Confirm
                    title="Delete Rows"
                    message={message}
                    variant="danger"
                    defaultChoice="cancel"
                    onConfirm={performDelete}
                    onCancel={() => setConfirmDelete(null)}
                />
            </Box>
        );

    }

    return (
        <Box flexDirection="column" gap={1}>
            {/* Header */}
            <Panel title={`DEBUG: ${tableInfo.displayName}`} borderColor="red" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Box gap={2}>
                        <Text>{rows.length} rows</Text>
                        <Text dimColor>|</Text>
                        <Text>Sorted by: <Text bold color="cyan">{sortColumn}</Text> {sortDirection === 'asc' ? '\u2191' : '\u2193'}</Text>
                    </Box>

                    {/* List with search */}
                    <SearchableList
                        items={listItems}
                        onSelect={handleSelect}
                        onHighlight={handleHighlight}
                        searchPlaceholder={`Filter ${tableInfo.displayName.toLowerCase()}...`}
                        emptyLabel="No rows in table"
                        noResultsLabel="No matching rows"
                        isFocused={isFocused}
                        numberNav
                        visibleCount={10}
                    />
                </Box>
            </Panel>

            {/* Hotkeys */}
            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[s] Sort column</Text>
                <Text dimColor>[S] Direction</Text>
                <Text dimColor>[d] Delete</Text>
                <Text dimColor>[D] Delete all</Text>
                <Text dimColor>[Enter] Detail</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Format a date value for display.
 */
function formatDate(value: unknown): string {

    if (!value) return '';

    if (value instanceof Date) {

        return value.toISOString().replace('T', ' ').slice(0, 19);

    }

    if (typeof value === 'string') {

        // Try to parse as date
        const d = new Date(value);

        if (!isNaN(d.getTime())) {

            return d.toISOString().replace('T', ' ').slice(0, 19);

        }

    }

    return String(value);

}

/**
 * Truncate a string to a maximum length.
 */
function truncate(str: string, maxLen: number): string {

    if (str.length <= maxLen) return str;

    return str.slice(0, maxLen - 3) + '...';

}
