/**
 * DebugDetailScreen - view a single row from a noorm internal table.
 *
 * Shows all fields of a row with delete capability.
 *
 * Keyboard shortcuts:
 * - d: Delete this row
 * - Esc: Go back
 */
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { NoormTableName, NoormTableRow } from '../../../core/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import type { Kysely } from 'kysely';

import { Panel, Spinner, Confirm, useToast } from '../../components/index.js';
import { createConnection, testConnection } from '../../../core/connection/index.js';
import { type NoormDatabase } from '../../../core/index.js';
import {
    createDebugOperations,
    getTableInfo,
    type DebugOperations,
} from '../../../core/debug/index.js';

/**
 * DebugDetailScreen component.
 *
 * Displays all fields of a single row from a noorm internal table.
 */
export function DebugDetailScreen({ params }: ScreenProps): ReactElement {

    const tableName = params.table as NoormTableName | undefined;
    const rowId = params.rowId as number | undefined;
    const tableInfo = tableName ? getTableInfo(tableName) : undefined;

    const { back } = useRouter();
    const { isFocused } = useFocusScope('DebugDetail');
    const { activeConfig, activeConfigName } = useAppContext();
    const { showToast } = useToast();

    // Data state
    const [row, setRow] = useState<NoormTableRow | null>(null);
    const [columns, setColumns] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Delete confirmation state
    const [showConfirm, setShowConfirm] = useState(false);

    // Operations ref for delete
    const [operations, setOperations] = useState<DebugOperations | null>(null);

    // Load row data
    useEffect(() => {

        if (!activeConfig || !tableName || rowId == null) {

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

            // Fetch row
            const [result, err] = await attempt(async () => {

                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__debug__',
                );

                const ops = createDebugOperations(conn.db as Kysely<NoormDatabase>);
                const cols = ops.getTableColumns(tableName);
                const data = await ops.getRowById(tableName, rowId);

                setOperations(ops);

                return { cols, data };

            });

            if (cancelled) return;

            if (err) {

                setError(err.message);

            }
            else if (result) {

                setColumns(result.cols);
                setRow(result.data);

            }

            setIsLoading(false);

        };

        load();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, tableName, rowId]);

    // Perform delete
    const performDelete = useCallback(async () => {

        if (!operations || !tableName || rowId == null) return;

        setShowConfirm(false);

        const success = await operations.deleteRowById(tableName, rowId);

        if (success) {

            showToast({ message: `Deleted row #${rowId}`, variant: 'success' });
            back();

        }
        else {

            showToast({ message: 'Delete failed', variant: 'error' });

        }

    }, [operations, tableName, rowId, showToast, back]);

    // Keyboard navigation
    useInput((input, key) => {

        if (!isFocused || showConfirm) return;

        if (key.escape) {

            back();

            return;

        }

        if (input === 'd') {

            setShowConfirm(true);

            return;

        }

    });

    // No table or row specified
    if (!tableName || !tableInfo || rowId == null) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="DEBUG MODE" borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="red">No table or row specified</Text>
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
                <Panel title={`DEBUG: Row #${rowId}`} borderColor="red" paddingX={1} paddingY={1}>
                    <Spinner label="Loading row..." />
                </Panel>
            </Box>
        );

    }

    // Error state
    if (error) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={`DEBUG: Row #${rowId}`} borderColor="red" paddingX={1} paddingY={1}>
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

    // Row not found
    if (!row) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={`DEBUG: Row #${rowId}`} borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="yellow">Row not found</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Delete confirmation
    if (showConfirm) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={`DEBUG: Row #${rowId}`} borderColor="red" paddingX={1} paddingY={1}>
                    <Text dimColor>{tableInfo.displayName} row</Text>
                </Panel>

                <Confirm
                    title="Delete Row"
                    message={`Delete row #${rowId} from ${tableName}?`}
                    variant="danger"
                    defaultChoice="cancel"
                    onConfirm={performDelete}
                    onCancel={() => setShowConfirm(false)}
                />
            </Box>
        );

    }

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={`DEBUG: Row #${rowId}`} borderColor="red" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {/* Table info */}
                    <Box gap={2}>
                        <Text dimColor>Table:</Text>
                        <Text bold>{tableName}</Text>
                    </Box>

                    {/* Row fields */}
                    <Box flexDirection="column" marginTop={1}>
                        {columns.map((col) => {

                            const value = row[col];

                            return (
                                <Box key={col} gap={2}>
                                    <Box width={20}>
                                        <Text bold color="cyan">{col}</Text>
                                    </Box>
                                    <Text>{formatValue(value)}</Text>
                                </Box>
                            );

                        })}
                    </Box>
                </Box>
            </Panel>

            {/* Hotkeys */}
            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[d] Delete</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Format a value for display.
 */
function formatValue(value: unknown): string {

    if (value === null || value === undefined) {

        return '<null>';

    }

    if (value instanceof Date) {

        return value.toISOString().replace('T', ' ').slice(0, 19);

    }

    if (typeof value === 'string') {

        // Check if it's a date string
        if (/^\d{4}-\d{2}-\d{2}/.test(value)) {

            const d = new Date(value);

            if (!isNaN(d.getTime())) {

                return d.toISOString().replace('T', ' ').slice(0, 19);

            }

        }

        // Truncate long strings
        if (value.length > 80) {

            return value.slice(0, 77) + '...';

        }

        return value || '<empty>';

    }

    if (typeof value === 'object') {

        return JSON.stringify(value);

    }

    return String(value);

}
