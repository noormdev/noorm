/**
 * React hooks for observer event subscriptions.
 *
 * Wraps @logosdx/observer in React patterns with automatic cleanup.
 * Eliminates boilerplate useEffect/cleanup for event subscriptions.
 *
 * @example
 * ```typescript
 * // Subscribe to events
 * useOnEvent('file:after', (data) => setProgress(data), [])
 *
 * // One-time subscription
 * useOnceEvent('build:complete', (data) => setResult(data), [])
 *
 * // Emit events
 * const emitStart = useEmit('build:start')
 * emitStart({ sqlPath, fileCount })
 *
 * // Promise-based subscription
 * const [result, error, pending, cancel] = useEventPromise('build:complete')
 * ```
 */
import { useEffect, useCallback, useState, useRef, useMemo, type DependencyList } from 'react';

import { observer, type NoormEvents, type NoormEventNames } from '../../core/observer.js';

/**
 * Subscribe to an observer event with automatic cleanup.
 *
 * The callback runs whenever the event is emitted. Cleanup happens
 * automatically on unmount or when dependencies change.
 *
 * @example
 * ```typescript
 * useOnEvent('change:complete', (data) => {
 *     setResults(prev => [...prev, data])
 * }, [])
 *
 * // With dependencies
 * useOnEvent('file:after', (data) => {
 *     if (data.filepath === targetFile) handleComplete(data)
 * }, [targetFile])
 * ```
 */
export function useOnEvent<E extends NoormEventNames>(
    event: E,
    callback: (data: NoormEvents[E]) => void,
    deps: DependencyList,
): void {

    // Store callback in ref to avoid re-subscribing on callback changes
    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    useEffect(() => {

        const cleanup = observer.on(event, (data) => {

            callbackRef.current(data);

        });

        return cleanup;

    }, [event, ...deps]);

}

/**
 * Subscribe to an observer event once with automatic cleanup.
 *
 * The callback runs only on the first emission. Automatically cleans up
 * after the event fires or on unmount.
 *
 * @example
 * ```typescript
 * useOnceEvent('build:complete', (data) => {
 *     setFinalResult(data)
 * }, [])
 * ```
 */
export function useOnceEvent<E extends NoormEventNames>(
    event: E,
    callback: (data: NoormEvents[E]) => void,
    deps: DependencyList,
): void {

    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    useEffect(() => {

        const cleanup = observer.once(event, (data) => {

            callbackRef.current(data);

        });

        return cleanup;

    }, [event, ...deps]);

}

/**
 * Get a memoized function to emit an observer event.
 *
 * Returns a stable callback reference that emits the specified event.
 * The callback only changes when dependencies change.
 *
 * @example
 * ```typescript
 * const emitStart = useEmit('build:start')
 *
 * const handleStart = () => {
 *     emitStart({ sqlPath: '/sql', fileCount: 10 })
 * }
 *
 * // With dependencies for dynamic event data
 * const emitProgress = useEmit('change:file')
 * emitProgress({ change: name, filepath, index, total })
 * ```
 */
export function useEmit<E extends NoormEventNames>(
    event: E,
    deps: DependencyList = [],
): (data: NoormEvents[E]) => void {

    return useCallback(
        (data: NoormEvents[E]) => {

            // Cast needed due to observer.emit's conditional type signature
            (observer.emit as (e: E, d: NoormEvents[E]) => void)(event, data);

        },
        [event, ...deps],
    );

}

/**
 * State for useEventPromise hook.
 */
export interface EventPromiseState<T> {
    /** The resolved value, or null if pending/error */
    value: T | null;

    /** The error if rejected, or null if pending/success */
    error: Error | null;

    /** Whether the promise is still pending */
    pending: boolean;
}

/**
 * Subscribe to an event as a promise with state management.
 *
 * Returns the current state and a cancel function. The promise resolves
 * on the first event emission. Call cancel to unsubscribe early.
 *
 * @example
 * ```typescript
 * const [result, error, pending, cancel] = useEventPromise('build:complete')
 *
 * if (pending) return <Spinner label="Building..." />
 * if (error) return <Text color="red">{error.message}</Text>
 * if (result) return <Text>Built {result.filesRun} files</Text>
 *
 * // Cancel on user action
 * useInput((input) => {
 *     if (input === 'q') cancel()
 * })
 * ```
 */
export function useEventPromise<E extends NoormEventNames>(
    event: E,
): [value: NoormEvents[E] | null, error: Error | null, pending: boolean, cancel: () => void] {

    const [state, setState] = useState<EventPromiseState<NoormEvents[E]>>({
        value: null,
        error: null,
        pending: true,
    });

    const cancelRef = useRef<(() => void) | null>(null);

    useEffect(() => {

        // Reset state on new subscription
        setState({ value: null, error: null, pending: true });

        const promise = observer.once(event);

        // Store cancel function using cleanup from EventPromise
        cancelRef.current = () => {

            promise.cleanup?.();
            setState((prev) => ({ ...prev, pending: false }));

        };

        promise
            .then((data) => {

                setState({ value: data, error: null, pending: false });

            })
            .catch((err) => {

                // Only set error if not cancelled
                if (err?.message !== 'Cancelled') {

                    setState({ value: null, error: err, pending: false });

                }

            });

        return () => {

            promise.cleanup?.();

        };

    }, [event]);

    const cancel = useCallback(() => {

        cancelRef.current?.();

    }, []);

    return [state.value, state.error, state.pending, cancel];

}

/**
 * Run a callback when specific screens are popped from history.
 *
 * This is useful for cleaning up state when navigating away from a screen.
 * The callback fires when `back()` is called and the popped route matches
 * one of the specified screens.
 *
 * @param screens - Screen route(s) to watch. Can be a single string or array.
 *                  Use prefix patterns like 'db/explore' to match all sub-routes.
 * @param callback - Function to run when a matching screen is popped.
 *
 * @example
 * ```typescript
 * // Clear explore filter state when any explore screen is popped
 * useOnScreenPopped('db/explore', () => {
 *     clearExploreFilters()
 * })
 *
 * // Watch multiple screens
 * useOnScreenPopped(['config/edit', 'config/add'], () => {
 *     resetFormState()
 * })
 * ```
 */
export function useOnScreenPopped(
    screens: string | string[],
    callback: (poppedRoute: string, toRoute: string) => void,
): void {

    const screensArray = useMemo(
        () => (Array.isArray(screens) ? screens : [screens]),
        [screens],
    );

    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    useOnEvent('router:popped', (data) => {

        // Check if the popped route matches any of the watched screens
        const matches = screensArray.some((screen) =>
            data.popped === screen || data.popped.startsWith(screen + '/'),
        );

        if (matches) {

            callbackRef.current(data.popped, data.to);

        }

    }, [screensArray]);

}
