/**
 * Hook for tracking update download progress via observer events.
 *
 * Subscribes to update:* events and maintains state for
 * displaying download progress in TUI screens.
 *
 * @example
 * ```tsx
 * function UpdateScreen() {
 *     const { state, reset } = useUpdateProgress();
 *
 *     return (
 *         <Box flexDirection="column">
 *             <Text>{state.received} / {state.total} bytes</Text>
 *             {state.retry && <Text>retry {state.retry.attempt + 1}/{state.retry.maxAttempts}: {state.retry.error}</Text>}
 *         </Box>
 *     );
 * }
 * ```
 */
import { useState, useCallback } from 'react';

import { useOnEvent } from './useObserver.js';

/**
 * Phase of the update installation.
 */
export type UpdatePhase = 'idle' | 'downloading' | 'complete';

/**
 * Last retry recorded by useUpdateProgress.
 */
export interface UpdateRetryInfo {

    /** Attempt number, 0-based */
    attempt: number;

    /** Maximum number of attempts */
    maxAttempts: number;

    /** Reason for the retry */
    error: string;

}

/**
 * State tracked by useUpdateProgress.
 */
export interface UpdateProgressState {

    /** Current phase of the update */
    phase: UpdatePhase;

    /** Bytes received so far */
    received: number;

    /** Total bytes expected, 0 when unknown */
    total: number;

    /** Most recent retry, or null if none has occurred */
    retry: UpdateRetryInfo | null;

}

/**
 * Initial state for update progress.
 */
const INITIAL_STATE: UpdateProgressState = {
    phase: 'idle',
    received: 0,
    total: 0,
    retry: null,
};

type UseUpdateProgressReturn = {
    state: UpdateProgressState;
    reset: () => void;
};

/**
 * Hook for tracking update download progress.
 *
 * Returns the current state and a reset function to prepare
 * for a new install.
 */
export function useUpdateProgress(): UseUpdateProgressReturn {

    const [state, setState] = useState<UpdateProgressState>(INITIAL_STATE);

    /**
     * Reset state for a new install.
     */
    const reset = useCallback(() => {

        setState(INITIAL_STATE);

    }, []);

    // Subscribe to update:installing
    useOnEvent(
        'update:installing',
        () => {

            setState(() => ({
                ...INITIAL_STATE,
                phase: 'downloading',
            }));

        },
        [],
    );

    // Subscribe to update:progress
    useOnEvent(
        'update:progress',
        (data) => {

            setState((prev) => ({
                ...prev,
                received: data.received,
                total: data.total,
            }));

        },
        [],
    );

    // Subscribe to update:retry
    useOnEvent(
        'update:retry',
        (data) => {

            setState((prev) => ({
                ...prev,
                retry: {
                    attempt: data.attempt,
                    maxAttempts: data.maxAttempts,
                    error: data.error,
                },
            }));

        },
        [],
    );

    // Subscribe to update:complete
    useOnEvent(
        'update:complete',
        () => {

            setState((prev) => ({
                ...prev,
                phase: 'complete',
            }));

        },
        [],
    );

    return { state, reset };

}
