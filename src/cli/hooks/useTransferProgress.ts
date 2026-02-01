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

                return {
                    ...prev,
                    currentRowsTransferred: data.rowsTransferred,
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

                return {
                    ...prev,
                    tablesCompleted: prev.tablesCompleted + 1,
                    rowsTransferred: prev.rowsTransferred + data.rowsTransferred,
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

    return { state, reset };

}
