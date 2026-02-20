/**
 * React hooks for observer event subscriptions.
 *
 * Thin wrappers around @logosdx/react's observer context that preserve
 * the existing consumer API (callbackRef pattern — no useCallback needed
 * by consumers).
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
 * const [waiting, result, cancel] = useEventPromise('build:complete')
 * ```
 */
import { useCallback, useRef, useMemo, type DependencyList } from 'react';

import { useNoormObserver } from '../observer-context.js';
import type { NoormEvents, NoormEventNames } from '../../core/observer.js';

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
 * ```
 */
export function useOnEvent<E extends NoormEventNames>(
    event: E,
    callback: (data: NoormEvents[E]) => void,
    deps: DependencyList,
): void {

    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    const { on } = useNoormObserver();
    const handler = useCallback((data: NoormEvents[E]) => callbackRef.current(data), []);

    on(event, handler);

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

    const { once } = useNoormObserver();
    const handler = useCallback((data: NoormEvents[E]) => callbackRef.current(data), []);

    once(event, handler);

}

/**
 * Get a memoized function to emit an observer event.
 *
 * Returns a stable callback reference that emits the specified event.
 *
 * @example
 * ```typescript
 * const emitStart = useEmit('build:start')
 * emitStart({ sqlPath: '/sql', fileCount: 10 })
 * ```
 */
export function useEmit<E extends NoormEventNames>(
    event: E,
    deps: DependencyList = [],
): (data: NoormEvents[E]) => void {

    const { emitFactory } = useNoormObserver();

    return emitFactory(event);

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
 * const [waiting, result, cancel] = useEventPromise('build:complete')
 *
 * if (waiting) return <Spinner label="Building..." />
 * if (result) return <Text>Built {result.filesRun} files</Text>
 * ```
 */
export function useEventPromise<E extends NoormEventNames>(
    event: E,
): [value: NoormEvents[E] | null, error: Error | null, pending: boolean, cancel: () => void] {

    const { oncePromise } = useNoormObserver();
    const [waiting, data, cancel] = oncePromise(event);

    return [data, null, waiting, cancel];

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
