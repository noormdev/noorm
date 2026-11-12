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
 * ```
 */
import { useCallback, useRef, type DependencyList } from 'react';

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
    _deps: DependencyList,
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
    _deps: DependencyList,
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
    _deps: DependencyList = [],
): (data: NoormEvents[E]) => void {

    const { emitFactory } = useNoormObserver();

    return emitFactory(event);

}

