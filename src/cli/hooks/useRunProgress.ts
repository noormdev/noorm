/**
 * Hook for tracking runner progress via observer events.
 *
 * Subscribes to build/file events and maintains state for
 * displaying progress in TUI screens.
 *
 * @example
 * ```tsx
 * function RunBuildScreen() {
 *     const { state, reset } = useRunProgress()
 *
 *     useEffect(() => {
 *         reset(totalFiles)
 *         runBuild(context, options)
 *     }, [])
 *
 *     return (
 *         <Box flexDirection="column">
 *             <Text>Running: {state.currentFile}</Text>
 *             <ProgressBar value={state.filesRun / state.filesTotal} />
 *             <Text>
 *                 {state.filesRun}/{state.filesTotal} files
 *                 ({state.filesSkipped} skipped, {state.filesFailed} failed)
 *             </Text>
 *         </Box>
 *     )
 * }
 * ```
 */
import { useState, useCallback } from 'react';

import { useOnEvent } from './useObserver.js';

/**
 * Phase of the run operation.
 */
export type RunPhase = 'idle' | 'running' | 'complete';

/**
 * Result entry tracked by useRunProgress.
 *
 * Simplified version of FileResult for progress display.
 */
export interface ProgressFileResult {
    /** File path */
    filepath: string;

    /** Result status */
    status: 'success' | 'failed' | 'skipped' | 'dry-run';

    /** Skip reason if skipped */
    skipReason?: string;

    /** Error message if failed */
    error?: string;

    /** Duration in ms */
    durationMs?: number;

    /** Output path for dry-run */
    outputPath?: string;
}

/**
 * State tracked by useRunProgress.
 */
export interface RunProgressState {
    /** Current phase of operation */
    phase: RunPhase;

    /** Currently executing file (or null if between files) */
    currentFile: string | null;

    /** Total number of files to process */
    filesTotal: number;

    /** Number of files successfully run */
    filesRun: number;

    /** Number of files skipped (unchanged or already run) */
    filesSkipped: number;

    /** Number of files that failed */
    filesFailed: number;

    /** Number of files rendered in dry-run mode */
    filesDryRun: number;

    /** Accumulated results for each file */
    results: ProgressFileResult[];

    /** Duration in milliseconds (updated on complete) */
    durationMs: number;

    /** Final status (set on complete) */
    status: 'success' | 'failed' | 'partial' | null;
}

/**
 * Initial state for run progress.
 */
const INITIAL_STATE: RunProgressState = {
    phase: 'idle',
    currentFile: null,
    filesTotal: 0,
    filesRun: 0,
    filesSkipped: 0,
    filesFailed: 0,
    filesDryRun: 0,
    results: [],
    durationMs: 0,
    status: null,
};

type UseRunProgressReturn = {
    state: RunProgressState;
    reset: (totalFiles: number) => void;
};

/**
 * Hook for tracking runner progress.
 *
 * Returns the current state and a reset function to prepare
 * for a new run.
 */
export function useRunProgress(): UseRunProgressReturn {

    const [state, setState] = useState<RunProgressState>(INITIAL_STATE);

    /**
     * Reset state for a new run.
     */
    const reset = useCallback((totalFiles: number) => {

        setState({
            ...INITIAL_STATE,
            filesTotal: totalFiles,
        });

    }, []);

    // Subscribe to build:start
    useOnEvent(
        'build:start',
        (data) => {

            setState((prev) => ({
                ...prev,
                phase: 'running',
                filesTotal: data.fileCount,
                currentFile: null,
            }));

        },
        [],
    );

    // Subscribe to file:before
    useOnEvent(
        'file:before',
        (data) => {

            setState((prev) => ({
                ...prev,
                currentFile: data.filepath,
            }));

        },
        [],
    );

    // Subscribe to file:after
    useOnEvent(
        'file:after',
        (data) => {

            setState((prev) => {

                const isSuccess = data.status === 'success';
                const result: ProgressFileResult = {
                    filepath: data.filepath,
                    status: data.status,
                    durationMs: data.durationMs,
                    error: data.error,
                };

                return {
                    ...prev,
                    filesRun: prev.filesRun + (isSuccess ? 1 : 0),
                    filesFailed: prev.filesFailed + (isSuccess ? 0 : 1),
                    results: [...prev.results, result],
                    currentFile: null,
                };

            });

        },
        [],
    );

    // Subscribe to file:skip
    useOnEvent(
        'file:skip',
        (data) => {

            setState((prev) => {

                const result: ProgressFileResult = {
                    filepath: data.filepath,
                    status: 'skipped',
                    skipReason: data.reason,
                };

                return {
                    ...prev,
                    filesSkipped: prev.filesSkipped + 1,
                    results: [...prev.results, result],
                };

            });

        },
        [],
    );

    // Subscribe to file:dry-run
    useOnEvent(
        'file:dry-run',
        (data) => {

            setState((prev) => {

                const isSuccess = data.status === 'success';
                const result: ProgressFileResult = {
                    filepath: data.filepath,
                    status: isSuccess ? 'dry-run' : 'failed',
                    outputPath: data.outputPath,
                    error: data.error,
                };

                return {
                    ...prev,
                    filesDryRun: prev.filesDryRun + (isSuccess ? 1 : 0),
                    filesFailed: prev.filesFailed + (isSuccess ? 0 : 1),
                    results: [...prev.results, result],
                    currentFile: null,
                };

            });

        },
        [],
    );

    // Subscribe to build:complete
    useOnEvent(
        'build:complete',
        (data) => {

            setState((prev) => ({
                ...prev,
                phase: 'complete',
                status: data.status,
                durationMs: data.durationMs,
                currentFile: null,
            }));

        },
        [],
    );

    return { state, reset };

}
