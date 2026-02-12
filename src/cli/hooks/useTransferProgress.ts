/**
 * Hook for tracking transfer progress via observer events.
 *
 * Subscribes to transfer:* events and maintains state for
 * displaying progress in TUI screens.
 *
 * @example
 * ```tsx
 * function TransferScreen() {
 *     const { state, reset } = useTransferProgress();
 *
 *     useEffect(() => {
 *         reset();
 *         transferData(source, dest, options);
 *     }, []);
 *
 *     return (
 *         <Box flexDirection="column">
 *             <Text>Transferring: {state.currentTable}</Text>
 *             <ProgressBar value={state.tablesCompleted / state.tableCount} />
 *             <Text>
 *                 {state.rowsTransferred} rows transferred
 *             </Text>
 *         </Box>
 *     );
 * }
 * ```
 */
import { useState, useCallback } from 'react';

import { useOnEvent } from './useObserver.js';

/**
 * Phase of the transfer operation.
 */
export type TransferPhase = 'idle' | 'planning' | 'running' | 'complete';

/**
 * Per-table result tracked by useTransferProgress.
 */
export interface TransferTableProgress {

    /** Table name */
    table: string;

    /** Result status */
    status: 'pending' | 'running' | 'success' | 'skipped' | 'failed';

    /** Rows transferred */
    rowsTransferred: number;

    /** Rows skipped due to conflicts */
    rowsSkipped: number;

    /** Total rows to transfer */
    rowsTotal: number;

    /** Duration in ms */
    durationMs?: number;

    /** Error message if failed */
    error?: string;

}

/**
 * Per-table export result tracked by useTransferProgress.
 */
export interface ExportTableProgress {

    /** Table name */
    table: string;

    /** Output file path */
    filepath: string;

    /** Rows written so far */
    rowsWritten: number;

    /** Bytes written so far */
    bytesWritten: number;

    /** Duration in ms (set on complete) */
    durationMs?: number;

}

/**
 * Import progress tracked by useTransferProgress.
 */
export interface ImportProgress {

    /** Input file path */
    filepath: string;

    /** Source dialect from .dt schema header */
    sourceDialect: string;

    /** Source version from .dt schema header */
    sourceVersion: string;

    /** Table being imported */
    table: string;

    /** Rows imported so far */
    rowsImported: number;

    /** Rows skipped so far */
    rowsSkipped: number;

    /** Duration in ms (set on complete) */
    durationMs?: number;

}

/**
 * State tracked by useTransferProgress.
 */
export interface TransferProgressState {

    /** Current phase of operation */
    phase: TransferPhase;

    /** Whether source and dest are on same server */
    sameServer: boolean;

    /** Total number of tables to transfer */
    tableCount: number;

    /** Number of tables completed */
    tablesCompleted: number;

    /** Currently transferring table (or null if not started) */
    currentTable: string | null;

    /** Current table index (0-based) */
    currentIndex: number;

    /** Total estimated rows across all tables */
    estimatedRows: number;

    /** Total rows transferred so far */
    rowsTransferred: number;

    /** Total rows skipped so far */
    rowsSkipped: number;

    /** Current table's progress */
    currentRowsTransferred: number;
    currentRowsTotal: number;

    /** Results for each table */
    results: TransferTableProgress[];

    /** Warnings from planning */
    warnings: string[];

    /** Duration in milliseconds (updated on complete) */
    durationMs: number;

    /** Final status (set on complete) */
    status: 'success' | 'partial' | 'failed' | null;

    /** Export progress (populated during dt:export operations) */
    exportTables: ExportTableProgress[];

    /** Import progress (populated during dt:import operations) */
    importProgress: ImportProgress | null;

}

/**
 * Initial state for transfer progress.
 */
const INITIAL_STATE: TransferProgressState = {
    phase: 'idle',
    sameServer: false,
    tableCount: 0,
    tablesCompleted: 0,
    currentTable: null,
    currentIndex: 0,
    estimatedRows: 0,
    rowsTransferred: 0,
    rowsSkipped: 0,
    currentRowsTransferred: 0,
    currentRowsTotal: 0,
    results: [],
    warnings: [],
    durationMs: 0,
    status: null,
    exportTables: [],
    importProgress: null,
};

type UseTransferProgressReturn = {
    state: TransferProgressState;
    reset: () => void;
};

/**
 * Hook for tracking transfer progress.
 *
 * Returns the current state and a reset function to prepare
 * for a new transfer.
 */
export function useTransferProgress(): UseTransferProgressReturn {

    const [state, setState] = useState<TransferProgressState>(INITIAL_STATE);

    /**
     * Reset state for a new transfer.
     */
    const reset = useCallback(() => {

        setState(INITIAL_STATE);

    }, []);

    // Subscribe to transfer:planning
    useOnEvent(
        'transfer:planning',
        () => {

            setState((prev) => ({
                ...prev,
                phase: 'planning',
            }));

        },
        [],
    );

    // Subscribe to transfer:plan:ready
    useOnEvent(
        'transfer:plan:ready',
        (data) => {

            setState((prev) => ({
                ...prev,
                sameServer: data.sameServer,
                tableCount: data.tableCount,
                estimatedRows: data.estimatedRows,
                warnings: data.warnings,
            }));

        },
        [],
    );

    // Subscribe to transfer:starting
    useOnEvent(
        'transfer:starting',
        (data) => {

            setState((prev) => ({
                ...prev,
                phase: 'running',
                tableCount: data.tableCount,
                sameServer: data.sameServer,
            }));

        },
        [],
    );

    // Subscribe to transfer:table:before
    useOnEvent(
        'transfer:table:before',
        (data) => {

            setState((prev) => {

                const result: TransferTableProgress = {
                    table: data.table,
                    status: 'running',
                    rowsTransferred: 0,
                    rowsSkipped: 0,
                    rowsTotal: data.rowCount,
                };

                return {
                    ...prev,
                    currentTable: data.table,
                    currentIndex: data.index,
                    currentRowsTransferred: 0,
                    currentRowsTotal: data.rowCount,
                    results: [...prev.results, result],
                };

            });

        },
        [],
    );

    // Subscribe to transfer:table:progress
    useOnEvent(
        'transfer:table:progress',
        (data) => {

            setState((prev) => {

                // Update current table's result
                const results = prev.results.map((r) => {

                    if (r.table === data.table) {

                        return {
                            ...r,
                            rowsTransferred: data.rowsTransferred,
                            rowsSkipped: data.rowsSkipped,
                        };

                    }

                    return r;

                });

                // Update aggregate: swap old currentRowsTransferred for new value
                const newRowsTransferred = prev.rowsTransferred - prev.currentRowsTransferred + data.rowsTransferred;

                return {
                    ...prev,
                    currentRowsTransferred: data.rowsTransferred,
                    rowsTransferred: newRowsTransferred,
                    results,
                };

            });

        },
        [],
    );

    // Subscribe to transfer:table:after
    useOnEvent(
        'transfer:table:after',
        (data) => {

            setState((prev) => {

                // Update current table's result
                const results = prev.results.map((r) => {

                    if (r.table === data.table) {

                        return {
                            ...r,
                            status: data.status,
                            rowsTransferred: data.rowsTransferred,
                            rowsSkipped: data.rowsSkipped,
                            durationMs: data.durationMs,
                            error: data.error,
                        };

                    }

                    return r;

                });

                // Swap current table's live-tracked rows for final count
                const newRowsTransferred = prev.rowsTransferred - prev.currentRowsTransferred + data.rowsTransferred;

                return {
                    ...prev,
                    tablesCompleted: prev.tablesCompleted + 1,
                    rowsTransferred: newRowsTransferred,
                    rowsSkipped: prev.rowsSkipped + data.rowsSkipped,
                    currentTable: null,
                    currentRowsTransferred: 0,
                    currentRowsTotal: 0,
                    results,
                };

            });

        },
        [],
    );

    // Subscribe to transfer:complete
    useOnEvent(
        'transfer:complete',
        (data) => {

            setState((prev) => ({
                ...prev,
                phase: 'complete',
                status: data.status,
                durationMs: data.durationMs,
                currentTable: null,
            }));

        },
        [],
    );

    // -----------------------------------------------------------------------
    // .dt export events
    // -----------------------------------------------------------------------

    useOnEvent(
        'dt:export:start',
        (data) => {

            setState((prev) => ({
                ...prev,
                phase: 'running',
                currentTable: data.table,
                exportTables: [
                    ...prev.exportTables,
                    {
                        table: data.table,
                        filepath: data.filepath,
                        rowsWritten: 0,
                        bytesWritten: 0,
                    },
                ],
            }));

        },
        [],
    );

    useOnEvent(
        'dt:export:progress',
        (data) => {

            setState((prev) => {

                const exportTables = prev.exportTables.map((t) => {

                    if (t.table === data.table) {

                        return {
                            ...t,
                            rowsWritten: data.rowsWritten,
                            bytesWritten: data.bytesWritten,
                        };

                    }

                    return t;

                });

                return {
                    ...prev,
                    currentRowsTransferred: data.rowsWritten,
                    exportTables,
                };

            });

        },
        [],
    );

    useOnEvent(
        'dt:export:complete',
        (data) => {

            setState((prev) => {

                const exportTables = prev.exportTables.map((t) => {

                    if (t.table === data.table) {

                        return {
                            ...t,
                            rowsWritten: data.rowsWritten,
                            bytesWritten: data.bytesWritten,
                            durationMs: data.durationMs,
                        };

                    }

                    return t;

                });

                return {
                    ...prev,
                    tablesCompleted: prev.tablesCompleted + 1,
                    rowsTransferred: prev.rowsTransferred + data.rowsWritten,
                    currentTable: null,
                    currentRowsTransferred: 0,
                    exportTables,
                };

            });

        },
        [],
    );

    // -----------------------------------------------------------------------
    // .dt import events
    // -----------------------------------------------------------------------

    useOnEvent(
        'dt:import:start',
        (data) => {

            setState((prev) => ({
                ...prev,
                phase: 'running',
                currentTable: data.table,
                tableCount: prev.tableCount + 1,
                importProgress: {
                    filepath: data.filepath,
                    sourceDialect: data.sourceDialect,
                    sourceVersion: data.sourceVersion,
                    table: data.table,
                    rowsImported: 0,
                    rowsSkipped: 0,
                },
            }));

        },
        [],
    );

    useOnEvent(
        'dt:import:progress',
        (data) => {

            setState((prev) => ({
                ...prev,
                currentRowsTransferred: data.rowsImported,
                rowsTransferred: prev.rowsTransferred - prev.currentRowsTransferred + data.rowsImported,
                importProgress: prev.importProgress
                    ? {
                        ...prev.importProgress,
                        rowsImported: data.rowsImported,
                        rowsSkipped: data.rowsSkipped,
                    }
                    : null,
            }));

        },
        [],
    );

    useOnEvent(
        'dt:import:complete',
        (data) => {

            setState((prev) => {

                // Compute aggregate rows: remove stale currentRowsTransferred and add final count
                const newRowsTransferred = prev.rowsTransferred - prev.currentRowsTransferred + data.rowsImported;

                return {
                    ...prev,
                    durationMs: prev.durationMs + data.durationMs,
                    rowsTransferred: newRowsTransferred,
                    rowsSkipped: prev.rowsSkipped + data.rowsSkipped,
                    tablesCompleted: prev.tablesCompleted + 1,
                    currentTable: null,
                    currentRowsTransferred: 0,
                    currentRowsTotal: 0,
                    importProgress: prev.importProgress
                        ? {
                            ...prev.importProgress,
                            rowsImported: data.rowsImported,
                            rowsSkipped: data.rowsSkipped,
                            durationMs: data.durationMs,
                        }
                        : null,
                };

            });

        },
        [],
    );

    return { state, reset };

}
